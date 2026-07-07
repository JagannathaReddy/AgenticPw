"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useConsoleStore } from "@/store/useConsoleStore";
import { ACCENT_COLOR } from "@/lib/meta";

type AssignTab = "fix" | "story" | "regression";

export default function TeammateAssignPage() {
  const router = useRouter();
  const repos = useConsoleStore((s) => s.repos);
  const submitFixAssignment = useConsoleStore((s) => s.submitFixAssignment);
  const submitStoryAssignment = useConsoleStore((s) => s.submitStoryAssignment);
  const submitRegressionAssignment = useConsoleStore((s) => s.submitRegressionAssignment);
  const showToast = useConsoleStore((s) => s.showToast);

  const [tab, setTab] = useState<AssignTab>("fix");
  const [repoId, setRepoId] = useState("");
  const [testPath, setTestPath] = useState("");
  const [specs, setSpecs] = useState<string[]>([]);
  const [specsLoading, setSpecsLoading] = useState(false);
  const [specsError, setSpecsError] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [outcomesText, setOutcomesText] = useState("");
  const [stewardRuns, setStewardRuns] = useState(3);
  const [quarantineFlaky, setQuarantineFlaky] = useState(true);
  const [autoApply, setAutoApply] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!repoId && repos[0]?.id) setRepoId(repos[0].id);
  }, [repos, repoId]);

  useEffect(() => {
    if (!repoId || tab !== "fix") return;
    let cancelled = false;
    setSpecsLoading(true);
    setSpecsError(null);
    void apiFetch<{ specs: string[] }>(`/v1/repos/${repoId}/specs`)
      .then((res) => {
        if (cancelled) return;
        setSpecs(res.specs);
        setTestPath((prev) => {
          if (prev && res.specs.includes(prev)) return prev;
          return res.specs[0] ?? "";
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setSpecs([]);
        setTestPath("");
        setSpecsError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setSpecsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, tab]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repoId) {
      showToast("Repo is required.");
      return;
    }
    setSubmitting(true);
    try {
      let manifestId: string;
      if (tab === "fix") {
        if (!testPath.trim()) {
          showToast("Test path is required.");
          return;
        }
        manifestId = await submitFixAssignment(repoId, testPath.trim(), { autoApply });
      } else if (tab === "story") {
        const expectedOutcomes = outcomesText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!targetUrl.trim() || expectedOutcomes.length === 0) {
          showToast("URL and at least one expected outcome are required.");
          return;
        }
        manifestId = await submitStoryAssignment(repoId, targetUrl.trim(), expectedOutcomes, {
          goal: goal.trim() || undefined,
          autoApply,
        });
      } else {
        manifestId = await submitRegressionAssignment(repoId, {
          stewardRuns,
          quarantineFlaky,
          autoApply,
        });
      }
      showToast("Assignment submitted — teammate is working.", 3000);
      router.push(`/manifest/${manifestId}`);
    } catch (err) {
      showToast((err as Error).message, 4000);
    } finally {
      setSubmitting(false);
    }
  }

  const tabLabels: Record<AssignTab, string> = {
    fix: "Fix failure",
    story: "Automate story",
    regression: "Full regression",
  };

  return (
    <div className="max-w-[640px] flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-bold m-0">Assign to Teammate</h1>
        <p className="text-[13px] text-[#6B7280] mt-1 mb-0">
          Fix a test, automate a story, or run a full regression loop — steward, heal, quarantine, verify.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["fix", "story", "regression"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-[13px] font-semibold px-3 py-2 rounded-lg border cursor-pointer ${
              tab === t
                ? "border-[#6D5EF0] bg-[#F5F3FF] text-[#6D5EF0]"
                : "border-[#E4E6EB] bg-white text-[#374151]"
            }`}
          >
            {tabLabels[t]}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="bg-white border border-[#E4E6EB] rounded-xl p-5 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Repo
          <select
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
            className="border border-[#E4E6EB] rounded-lg px-3 py-2 text-[13px] font-normal"
          >
            {repos.length === 0 ? (
              <option value="">No repos registered</option>
            ) : (
              repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))
            )}
          </select>
        </label>

        {tab === "fix" && (
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Spec to fix
            <select
              value={testPath}
              onChange={(e) => setTestPath(e.target.value)}
              disabled={specsLoading || specs.length === 0}
              className="border border-[#E4E6EB] rounded-lg px-3 py-2 text-[13px] font-normal disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
            >
              {specsLoading ? (
                <option value="">Loading specs…</option>
              ) : specs.length === 0 ? (
                <option value="">No specs found in repo</option>
              ) : (
                specs.map((spec) => (
                  <option key={spec} value={spec}>
                    {spec}
                  </option>
                ))
              )}
            </select>
            {specsError && (
              <span className="text-[12px] font-normal text-[#DC2626]">{specsError}</span>
            )}
            {!specsLoading && specs.length > 0 && (
              <span className="text-[12px] font-normal text-[#6B7280]">
                {specs.length} spec{specs.length === 1 ? "" : "s"} in repo
              </span>
            )}
          </label>
        )}

        {tab === "story" && (
          <>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Target URL
              <input
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://app.example.com/login"
                className="border border-[#E4E6EB] rounded-lg px-3 py-2 text-[13px] font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              User story / goal (optional)
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="User can log in with valid credentials"
                className="border border-[#E4E6EB] rounded-lg px-3 py-2 text-[13px] font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Expected outcomes (one per line)
              <textarea
                value={outcomesText}
                onChange={(e) => setOutcomesText(e.target.value)}
                rows={4}
                placeholder={"Dashboard is visible after login\nUser name appears in header"}
                className="border border-[#E4E6EB] rounded-lg px-3 py-2 text-[13px] font-normal resize-y"
              />
            </label>
          </>
        )}

        {tab === "regression" && (
          <>
            <p className="text-[13px] text-[#6B7280] m-0">
              Runs steward (K runs), batch-heals safe failures, quarantines flaky tests, then verifies with a
              second steward pass. Auth/setup failures escalate without infinite heal attempts.
            </p>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Steward runs (baseline)
              <input
                type="number"
                min={1}
                max={10}
                value={stewardRuns}
                onChange={(e) => setStewardRuns(Number(e.target.value))}
                className="border border-[#E4E6EB] rounded-lg px-3 py-2 text-[13px] font-normal w-24"
              />
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={quarantineFlaky}
                onChange={(e) => setQuarantineFlaky(e.target.checked)}
              />
              Quarantine flaky tests (test.fixme)
            </label>
          </>
        )}

        {tab !== "regression" && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
            Auto-apply verified patch (trust L2)
          </label>
        )}

        {tab === "regression" && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
            Auto-apply heals and quarantine patches (trust L2)
          </label>
        )}

        <button
          type="submit"
          disabled={submitting || (tab === "fix" && (specsLoading || !testPath))}
          className="text-white text-[13px] font-semibold px-4 py-2.5 rounded-lg border-0 cursor-pointer disabled:opacity-60"
          style={{ background: ACCENT_COLOR }}
        >
          {submitting
            ? "Submitting…"
            : tab === "fix"
              ? "Assign fix"
              : tab === "story"
                ? "Assign story"
                : "Assign regression"}
        </button>
      </form>
    </div>
  );
}
