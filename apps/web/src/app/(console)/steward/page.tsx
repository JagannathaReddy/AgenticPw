"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useConsoleStore } from "@/store/useConsoleStore";
import { buildStewardReportRows, stewardRunsForRepo } from "@/lib/selectors";
import { relTime, shortId } from "@/lib/format";
import { apiFetch } from "@/lib/api";
import { ACCENT_COLOR, STATUS_META } from "@/lib/meta";
import type { StewardReportPayload } from "@/lib/types";

export default function StewardPage() {
  const router = useRouter();
  const manifests = useConsoleStore((s) => s.manifests);
  const repos = useConsoleStore((s) => s.repos);
  const runBatchFromSteward = useConsoleStore((s) => s.runBatchFromSteward);
  const submitQuarantine = useConsoleStore((s) => s.submitQuarantine);
  const showToast = useConsoleStore((s) => s.showToast);
  const reports = buildStewardReportRows(manifests);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedManifestId, setSelectedManifestId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<StewardReportPayload | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sel = selectedRepo || reports[0]?.repo || repos[0]?.name;
  const selected = reports.find((r) => r.repo === sel);
  const repoRuns = sel ? stewardRunsForRepo(manifests, sel) : [];
  const activeManifestId = selectedManifestId ?? repoRuns[0]?.manifestId ?? selected?.manifestId;

  // Reset during render when the target changes — the effect below must not
  // call setState synchronously (react-hooks/set-state-in-effect).
  const [prevManifestId, setPrevManifestId] = useState(activeManifestId);
  if (activeManifestId !== prevManifestId) {
    setPrevManifestId(activeManifestId);
    setReportData(null);
    setReportError(null);
  }

  useEffect(() => {
    if (!activeManifestId) return;
    let cancelled = false;
    void apiFetch<StewardReportPayload>(`/v1/tests/${activeManifestId}/steward-report`)
      .then((data) => {
        if (cancelled) return;
        setReportData(data);
        setReportError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setReportData(null);
        setReportError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [activeManifestId]);

  if (!sel) {
    return (
      <div className="max-w-[1180px] bg-white border border-[#E4E6EB] rounded-xl p-10 text-center text-[#9CA3AF]">
        No steward reports yet — run <code className="font-mono">npm run agent -- steward</code>
      </div>
    );
  }

  const repoId = repos.find((r) => r.name === sel)?.id;
  const total = (selected?.healthy ?? 0) + (selected?.flaky ?? 0) + (selected?.broken ?? 0) || 1;
  const healthyPct = Math.round(((selected?.healthy ?? 0) / total) * 100) + "%";
  const flakyPct = Math.round(((selected?.flaky ?? 0) / total) * 100) + "%";
  const brokenPct = Math.round(((selected?.broken ?? 0) / total) * 100) + "%";

  const handleBatchHeal = async () => {
    const mid = selected?.manifestId;
    if (!repoId || !mid) {
      showToast("Missing repo or successful steward report.", 3000);
      return;
    }
    setBusy(true);
    try {
      const id = await runBatchFromSteward(mid, repoId);
      router.push(`/manifest/${id}`);
    } catch (err) {
      showToast((err as Error).message, 4000);
    } finally {
      setBusy(false);
    }
  };

  const handleQuarantine = async (autoApply: boolean) => {
    const mid = selected?.manifestId;
    if (!mid) {
      showToast("Need a successful steward report to quarantine flaky tests.", 3000);
      return;
    }
    setBusy(true);
    try {
      const id = await submitQuarantine(mid, repoId, autoApply);
      router.push(`/manifest/${id}`);
    } catch (err) {
      showToast((err as Error).message, 4000);
    } finally {
      setBusy(false);
    }
  };

  const failing = reportData?.failing ?? [];

  return (
    <div className="flex gap-4 max-w-[1180px] items-start">
      <div className="w-[260px] flex-none bg-white border border-[#E4E6EB] rounded-xl p-2">
        {[...new Set([...reports.map((r) => r.repo), ...repos.map((r) => r.name)])].map((repo) => (
          <div
            key={repo}
            onClick={() => {
              setSelectedRepo(repo);
              setSelectedManifestId(null);
            }}
            className="py-3 px-3.5 rounded-lg cursor-pointer m-0.5"
            style={{ background: repo === sel ? "#EEEBFE" : undefined }}
          >
            <div className="text-[13.5px] font-bold">{repo}</div>
            {reports.find((r) => r.repo === repo) && (
              <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">
                {reports.find((r) => r.repo === repo)!.dateLabel} ·{" "}
                {reports.find((r) => r.repo === repo)!.healthPct}% healthy
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex-1 flex flex-col gap-4">
        {selected ? (
          <div className="bg-white border border-[#E4E6EB] rounded-xl p-5">
            <div className="flex items-center gap-2.5">
              <div className="text-[15px] font-bold">{selected.repo}</div>
              <div className="text-[12px] text-[#9CA3AF]">latest success · {selected.dateLabel}</div>
            </div>
            <div className="flex gap-6 mt-4">
              <div>
                <div className="text-[11px] text-[#9CA3AF] font-bold">HEALTHY</div>
                <div className="text-[20px] font-bold text-[#16A34A]">{selected.healthy}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#9CA3AF] font-bold">FLAKY</div>
                <div className="text-[20px] font-bold text-[#D97706]">{selected.flaky}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#9CA3AF] font-bold">BROKEN</div>
                <div className="text-[20px] font-bold text-[#DC2626]">{selected.broken}</div>
              </div>
            </div>
            <div className="h-2.5 rounded-full bg-[#EEF0F2] mt-4 overflow-hidden flex">
              <div className="h-full bg-[#16A34A]" style={{ width: healthyPct }} />
              <div className="h-full bg-[#D97706]" style={{ width: flakyPct }} />
              <div className="h-full bg-[#DC2626]" style={{ width: brokenPct }} />
            </div>
          </div>
        ) : (
          <div className="bg-white border border-[#E4E6EB] rounded-xl p-5 text-[13px] text-[#9CA3AF]">
            No successful steward run yet for {sel}.
          </div>
        )}

        {/* Run history — includes rejected attempts */}
        <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
          <div className="py-3.5 px-5 border-b border-[#EEF0F2] text-[13.5px] font-bold">Recent runs</div>
          {repoRuns.length === 0 && (
            <div className="py-6 text-center text-[#9CA3AF] text-[13px]">No steward runs yet.</div>
          )}
          {repoRuns.map((run) => {
            const sm = STATUS_META[run.status];
            const active = run.manifestId === activeManifestId;
            return (
              <div
                key={run.manifestId}
                onClick={() => setSelectedManifestId(run.manifestId)}
                className="flex items-center gap-3 py-3 px-5 border-b border-[#F5F6F8] cursor-pointer last:border-0"
                style={{ background: active ? "#FAFAFF" : undefined }}
              >
                <span className="font-mono text-[12px] text-[#6B7280]">{shortId(run.manifestId)}</span>
                <span
                  className="text-[11px] font-bold py-0.5 px-2 rounded-full"
                  style={{ color: sm.fg, background: sm.bg }}
                >
                  {sm.label}
                </span>
                <span className="text-[12px] text-[#9CA3AF] flex-1 truncate">
                  {run.failureReason ?? (run.status !== "rejected" ? `${run.broken} broken · ${run.flaky} flaky` : "")}
                </span>
                <span className="text-[11.5px] text-[#9CA3AF]">{relTime(run.date)}</span>
              </div>
            );
          })}
        </div>

        {/* Failures for selected run */}
        <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
          <div className="py-3.5 px-5 border-b border-[#EEF0F2] flex items-center gap-3">
            <div className="text-[13.5px] font-bold flex-1">
              {reportData?.status === "rejected" ? "Failure detail" : `Failing tests (${failing.length})`}
            </div>
            {activeManifestId && (
              <div
                onClick={() => router.push(`/manifest/${activeManifestId}`)}
                className="text-[12px] font-semibold cursor-pointer"
                style={{ color: ACCENT_COLOR }}
              >
                Open manifest →
              </div>
            )}
          </div>

          {reportData?.status === "rejected" && (
            <div className="py-4 px-5 text-[13px] text-[#DC2626] whitespace-pre-wrap font-mono leading-relaxed bg-[#FEF2F2]">
              {reportData.reason}
            </div>
          )}

          {reportData?.status === "succeeded" && failing.length === 0 && (
            <div className="py-8 text-center text-[#9CA3AF] text-[13px]">All tests passed in every run.</div>
          )}

          {reportData?.status === "succeeded" &&
            failing.map((t, i) => (
              <div key={i} className="py-3.5 px-5 border-b border-[#F5F6F8] last:border-0">
                <div className="flex gap-3">
                  <span
                    className="text-[10.5px] font-bold py-0.5 px-2 rounded-full flex-none"
                    style={{
                      color: t.verdict === "flaky" ? "#D97706" : "#DC2626",
                      background: t.verdict === "flaky" ? "#FEF3C7" : "#FEE2E2",
                    }}
                  >
                    {t.verdict === "flaky" ? "Flaky" : "Broken"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold font-mono truncate">{t.file}</div>
                    <div className="text-[12.5px] text-[#4B5563]">{t.title}</div>
                    {t.errorHeads?.[0] && (
                      <div className="mt-2 text-[12px] text-[#DC2626] bg-[#FEF2F2] rounded-lg py-2 px-2.5 font-mono whitespace-pre-wrap">
                        {t.errorHeads[0]}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

          {!reportData && !reportError && activeManifestId && (
            <div className="py-6 text-center text-[#9CA3AF] text-[13px]">Loading…</div>
          )}

          {!reportData && reportError && (
            <div className="py-4 px-5 text-[13px] text-[#DC2626] whitespace-pre-wrap">
              {reportError}
            </div>
          )}
        </div>

        {selected && selected.healCandidates > 0 && (
          <div className="bg-white border border-[#E4E6EB] rounded-xl p-5 flex items-center justify-between">
            <div>
              <div className="text-[13.5px] font-bold">{selected.healCandidates} heal candidates</div>
              <div className="text-[12px] text-[#9CA3AF] mt-0.5">Consistently failing specs across {selected.repo}</div>
            </div>
            <div
              onClick={() => !busy && void handleBatchHeal()}
              className="text-[13px] font-bold text-white py-2.5 px-4 rounded-lg cursor-pointer"
              style={{ background: busy ? "#C7C2FA" : ACCENT_COLOR }}
            >
              Batch heal all
            </div>
          </div>
        )}

        {selected && selected.flaky > 0 && (
          <div className="bg-white border border-[#E4E6EB] rounded-xl p-5 flex items-center justify-between">
            <div>
              <div className="text-[13.5px] font-bold">{selected.flaky} flaky tests</div>
              <div className="text-[12px] text-[#9CA3AF] mt-0.5">Quarantine from latest successful report</div>
            </div>
            <div className="flex gap-2">
              <div
                onClick={() => !busy && void handleQuarantine(false)}
                className="text-[12.5px] font-semibold text-[#4B5563] py-2 px-3.5 border border-[#E4E6EB] rounded-lg cursor-pointer"
              >
                Quarantine
              </div>
              <div
                onClick={() => !busy && void handleQuarantine(true)}
                className="text-[12.5px] font-bold text-white py-2 px-3.5 rounded-lg cursor-pointer"
                style={{ background: busy ? "#C7C2FA" : ACCENT_COLOR }}
              >
                Quarantine + auto-apply
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
