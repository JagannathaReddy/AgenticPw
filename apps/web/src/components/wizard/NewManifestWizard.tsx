"use client";

import { useRouter } from "next/navigation";
import { useConsoleStore } from "@/store/useConsoleStore";
import { ACCENT_COLOR } from "@/lib/meta";
import type { Flow } from "@/lib/types";

const FLOW_CARDS: { key: Flow; title: string; desc: string }[] = [
  { key: "add", title: "Add", desc: "Describe a new test in English" },
  { key: "heal", title: "Heal", desc: "Fix a failing spec" },
  { key: "improve", title: "Improve", desc: "Polish an existing spec" },
  { key: "batch", title: "Batch", desc: "Heal many specs at once" },
  { key: "steward", title: "Steward", desc: "Run a suite-health check" },
];

const labelCls = "text-[12px] font-bold text-[#4B5563] mb-1.5";
const inputCls =
  "w-full box-border py-2.5 px-3 border border-[#E4E6EB] rounded-lg text-[13px] outline-none font-[inherit]";

function repoName(repos: { id: string; name: string }[], repoId: string) {
  return repos.find((r) => r.id === repoId)?.name ?? repoId;
}

function cliFor(
  flow: Flow | null,
  form: ReturnType<typeof useConsoleStore.getState>["wizardForm"],
  repos: { id: string; name: string }[],
) {
  const repo = repoName(repos, form.repoId);
  switch (flow) {
    case "add":
      return `agent add --goal "${(form.goal || "").slice(0, 60)}" --url "${form.url || ""}" --repo ${repo} --max-steps ${form.maxSteps}`;
    case "heal":
      return `agent heal ${form.specPath || ""}${form.pageObjectPath ? ` --page-object ${form.pageObjectPath}` : ""}${form.autoApply ? " --auto-apply" : ""}${form.healMaxCost ? ` --max-cost ${form.healMaxCost}` : ""} --repo ${repo}`;
    case "improve":
      return `agent improve ${form.specPath || ""}${form.pageObjectPath ? ` --page-object ${form.pageObjectPath}` : ""} --repo ${repo}`;
    case "batch":
      return `agent batch --source ${form.batchSource} --max-cost ${form.maxCost} --repo ${repo}`;
    case "steward":
      return `agent steward --repo ${repo} --runs ${form.runCount}`;
    default:
      return "";
  }
}

function costEstimateFor(flow: Flow | null, maxCost: number) {
  switch (flow) {
    case "add":
      return "$0.002 – $0.006";
    case "heal":
      return "$0.010 – $0.020";
    case "improve":
      return "$0.006 – $0.012";
    case "batch":
      return "up to $" + (maxCost || 5);
    case "steward":
      return "$0.03 – $0.08";
    default:
      return "—";
  }
}

export default function NewManifestWizard() {
  const router = useRouter();
  const s = useConsoleStore();
  const repos = useConsoleStore((st) => st.repos);
  const { wizardStep: step, wizardFlow: flow, wizardForm: form } = s;

  const repoSelect = (
    <select
      value={form.repoId}
      onChange={(e) => s.updateWizardField("repoId", e.target.value)}
      className={inputCls}
    >
      {repos.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );

  const canNext2 =
    flow === "add"
      ? !!form.goal && !!form.url && !(s.preflightBlocked && !form.storageState)
      : flow === "heal"
      ? !!form.specPath
      : flow === "improve"
      ? !!form.specPath
      : true;

  const handleSubmit = async () => {
    try {
      const id = await s.submitWizard();
      router.push(`/manifest/${id}`);
    } catch (err) {
      s.showToast((err as Error).message, 4000);
    }
  };

  const updateOutcome = (i: number, val: string) => {
    const arr = form.outcomes.slice();
    arr[i] = val;
    s.updateWizardField("outcomes", arr);
  };
  const updateGlob = (i: number, val: string) => {
    const arr = form.includeGlobs.slice();
    arr[i] = val;
    s.updateWizardField("includeGlobs", arr);
  };

  return (
    <div className="fixed inset-0 bg-[rgba(20,22,27,0.5)] z-[400] flex items-center justify-center">
      <div
        className="w-[640px] max-h-[86vh] bg-white rounded-[14px] flex flex-col shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
        style={{ animation: "fade-in 0.15s ease" }}
      >
        <div className="flex items-center gap-2.5 py-4.5 px-5.5 border-b border-[#EEF0F2]">
          <div className="text-[15px] font-bold flex-1">New manifest</div>
          <div className="flex gap-1.5">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className="w-[7px] h-[7px] rounded-full"
                style={{ background: n <= step ? ACCENT_COLOR : "#E4E6EB" }}
              />
            ))}
          </div>
          <div
            onClick={s.closeWizard}
            className="cursor-pointer text-[#9CA3AF] text-[16px] py-1 px-1.5"
          >
            ✕
          </div>
        </div>

        <div className="p-5.5 overflow-y-auto flex-1">
          {step === 1 && (
            <>
              <div className="text-[13px] text-[#6B7280] mb-4">What do you want AgenticPw to do?</div>
              <div className="grid grid-cols-2 gap-2.5">
                {FLOW_CARDS.map((fc) => (
                  <div
                    key={fc.key}
                    onClick={() => s.pickFlow(fc.key)}
                    className="border border-[#E4E6EB] rounded-[10px] p-3.5 cursor-pointer hover:border-[color:var(--accent)] hover:bg-[#FAFAFF] transition-colors"
                    style={{ ["--accent" as string]: ACCENT_COLOR }}
                  >
                    <div className="text-[13.5px] font-bold">{fc.title}</div>
                    <div className="text-[12px] text-[#9CA3AF] mt-1">{fc.desc}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 2 && flow === "add" && (
            <div className="flex flex-col gap-3.5">
              <div>
                <div className={labelCls}>Goal</div>
                <textarea
                  value={form.goal}
                  onChange={(e) => s.updateWizardField("goal", e.target.value.slice(0, 500))}
                  rows={3}
                  placeholder="Describe the scenario in plain English…"
                  className={inputCls + " resize-y"}
                />
                <div className="text-[11px] text-[#9CA3AF] mt-0.5 text-right">{form.goal.length}/500</div>
              </div>
              <div>
                <div className={labelCls}>URL</div>
                <input
                  value={form.url}
                  onChange={(e) => s.updateWizardField("url", e.target.value)}
                  placeholder="https://…"
                  className={inputCls}
                />
                {s.preflightChecked && s.preflightBlocked && (
                  <div className="mt-2 py-2.5 px-3 bg-[#FEF3C7] rounded-lg text-[12px] text-[#92400E] leading-relaxed">
                    This URL requires auth. Attach a storage state (auto-detected: <b>.auth/iac.storage.json</b>, refreshed 3h ago) or upload a fresh one.
                  </div>
                )}
                {s.preflightChecked && !s.preflightBlocked && (
                  <div className="mt-2 py-2 px-3 bg-[#DCFCE7] rounded-lg text-[12px] text-[#15803D]">
                    Reachable, no auth wall detected.
                  </div>
                )}
                <div
                  onClick={s.runPreflight}
                  className="inline-block mt-2 text-[11.5px] font-semibold cursor-pointer"
                  style={{ color: ACCENT_COLOR }}
                >
                  Run pre-flight check
                </div>
              </div>
              {s.preflightBlocked && (
                <div>
                  <div className={labelCls}>Storage state</div>
                  <div className="flex gap-2">
                    <div
                      onClick={() => s.updateWizardField("storageState", "auto:.auth/iac.storage.json")}
                      className="text-[12.5px] font-bold text-white py-2.5 px-3.5 rounded-lg cursor-pointer"
                      style={{ background: ACCENT_COLOR }}
                    >
                      Use auto-detected
                    </div>
                    <div className="text-[12.5px] font-semibold text-[#4B5563] py-2.5 px-3.5 border border-[#E4E6EB] rounded-lg cursor-pointer">
                      Upload…
                    </div>
                  </div>
                </div>
              )}
              <div>
                <div className={labelCls}>Expected outcomes</div>
                {form.outcomes.map((v, i) => (
                  <input
                    key={i}
                    value={v}
                    onChange={(e) => updateOutcome(i, e.target.value)}
                    placeholder="e.g. status pill reads ON"
                    className={inputCls + " mb-1.5"}
                  />
                ))}
                <div
                  onClick={() => s.updateWizardField("outcomes", [...form.outcomes, ""])}
                  className="text-[11.5px] font-semibold cursor-pointer"
                  style={{ color: ACCENT_COLOR }}
                >
                  + add outcome
                </div>
              </div>
              <div className="flex gap-5">
                <div className="flex-1">
                  <div className={labelCls}>Max steps: {form.maxSteps}</div>
                  <input
                    type="range"
                    min={3}
                    max={20}
                    value={form.maxSteps}
                    onChange={(e) => s.updateWizardField("maxSteps", +e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="flex-1">
                  <div className={labelCls}>Repo</div>
                  {repoSelect}
                </div>
              </div>
            </div>
          )}

          {step === 2 && flow === "heal" && (
            <div className="flex flex-col gap-3.5">
              <div>
                <div className={labelCls}>Spec path</div>
                <input
                  value={form.specPath}
                  onChange={(e) => s.updateWizardField("specPath", e.target.value)}
                  placeholder="tests/ui/iac/create-streetlight.spec.ts"
                  className={inputCls}
                />
              </div>
              <div>
                <div className={labelCls}>Page object path (optional)</div>
                <input
                  value={form.pageObjectPath}
                  onChange={(e) => s.updateWizardField("pageObjectPath", e.target.value)}
                  placeholder="tests/ui/iac/pages/create-streetlight.page.ts"
                  className={inputCls}
                />
              </div>
              <div>
                <div className={labelCls}>Repo</div>
                {repoSelect}
              </div>
              <div>
                <div className={labelCls}>Include globs</div>
                {form.includeGlobs.map((v, i) => (
                  <input
                    key={i}
                    value={v}
                    onChange={(e) => updateGlob(i, e.target.value)}
                    placeholder="tests/ui/iac/**"
                    className={inputCls + " mb-1.5"}
                  />
                ))}
                <div
                  onClick={() => s.updateWizardField("includeGlobs", [...form.includeGlobs, ""])}
                  className="text-[11.5px] font-semibold cursor-pointer"
                  style={{ color: ACCENT_COLOR }}
                >
                  + add glob
                </div>
              </div>
              <div className="flex gap-5 items-end">
                <div className="flex-1">
                  <div className={labelCls}>Max cost (USD)</div>
                  <input
                    type="number"
                    min={0.01}
                    max={50}
                    step={0.5}
                    value={form.healMaxCost}
                    onChange={(e) => s.updateWizardField("healMaxCost", +e.target.value || 2)}
                    className={inputCls}
                    style={{ width: 120 }}
                  />
                </div>
                <label className="flex items-center gap-2 text-[13px] font-semibold text-[#4B5563] pb-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.autoApply}
                    onChange={(e) => s.updateWizardField("autoApply", e.target.checked)}
                  />
                  Auto-apply on success
                </label>
              </div>
            </div>
          )}

          {step === 2 && flow === "improve" && (
            <div className="flex flex-col gap-3.5">
              <div>
                <div className={labelCls}>Spec path</div>
                <input
                  value={form.specPath}
                  onChange={(e) => s.updateWizardField("specPath", e.target.value)}
                  placeholder="tests/ui/checkout/apply-coupon.spec.ts"
                  className={inputCls}
                />
              </div>
              <div>
                <div className={labelCls}>Page object path (optional)</div>
                <input
                  value={form.pageObjectPath}
                  onChange={(e) => s.updateWizardField("pageObjectPath", e.target.value)}
                  placeholder="tests/ui/checkout/pages/checkout.page.ts"
                  className={inputCls}
                />
              </div>
              <div>
                <div className={labelCls}>Repo</div>
                {repoSelect}
              </div>
            </div>
          )}

          {step === 2 && flow === "batch" && (
            <div className="flex flex-col gap-3.5">
              <div>
                <div className={labelCls}>Source</div>
                <div className="flex gap-2">
                  <div
                    onClick={() => s.updateWizardField("batchSource", "glob")}
                    className="text-[12.5px] font-semibold py-2 px-3.5 rounded-lg cursor-pointer"
                    style={
                      form.batchSource === "glob"
                        ? { background: "#EEEBFE", color: ACCENT_COLOR }
                        : { border: "1px solid #E4E6EB", color: "#4B5563" }
                    }
                  >
                    Glob
                  </div>
                  <div
                    onClick={() => s.updateWizardField("batchSource", "from-steward")}
                    className="text-[12.5px] font-semibold py-2 px-3.5 rounded-lg cursor-pointer"
                    style={
                      form.batchSource === "from-steward"
                        ? { background: "#EEEBFE", color: ACCENT_COLOR }
                        : { border: "1px solid #E4E6EB", color: "#4B5563" }
                    }
                  >
                    From Steward candidates
                  </div>
                </div>
              </div>
              <div>
                <div className={labelCls}>Max cost</div>
                <input
                  value={form.maxCost}
                  onChange={(e) => s.updateWizardField("maxCost", +e.target.value || 0)}
                  className={inputCls}
                  style={{ width: 120 }}
                />
              </div>
              {form.batchSource === "glob" && (
                <div>
                  <div className={labelCls}>Spec glob</div>
                  <input
                    value={form.includeGlobs[0] ?? ""}
                    onChange={(e) => updateGlob(0, e.target.value)}
                    placeholder="tests/ui/**/*.spec.ts"
                    className={inputCls}
                  />
                </div>
              )}
              <div>
                <div className={labelCls}>Repo</div>
                {repoSelect}
              </div>
            </div>
          )}

          {step === 2 && flow === "steward" && (
            <div className="flex flex-col gap-3.5">
              <div>
                <div className={labelCls}>Repo</div>
                {repoSelect}
              </div>
              <div>
                <div className={labelCls}>Run count: {form.runCount}</div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={form.runCount}
                  onChange={(e) => s.updateWizardField("runCount", +e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3.5">
              <div>
                <div className={labelCls}>Equivalent CLI command</div>
                <div className="bg-[#14161B] text-[#D5D8DE] font-mono text-[12.5px] py-3 px-3.5 rounded-lg whitespace-pre-wrap break-all">
                  {cliFor(flow, form, repos)}
                </div>
              </div>
              <div className="flex gap-5">
                <div>
                  <div className="text-[11px] text-[#9CA3AF] font-bold">ESTIMATED COST</div>
                  <div className="text-[18px] font-bold mt-1">{costEstimateFor(flow, form.maxCost)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#9CA3AF] font-bold">FLOW</div>
                  <div className="text-[18px] font-bold mt-1 capitalize">{flow}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#9CA3AF] font-bold">REPO</div>
                  <div className="text-[18px] font-bold mt-1">{repoName(repos, form.repoId)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 py-4 px-5.5 border-t border-[#EEF0F2]">
          {step > 1 && (
            <div
              onClick={s.wizardBack}
              className="text-[12.5px] font-semibold text-[#4B5563] py-2.5 px-4 border border-[#E4E6EB] rounded-lg cursor-pointer"
            >
              Back
            </div>
          )}
          <div className="flex-1" />
          {step < 3 && (
            <div
              onClick={() => {
                if (step === 2 && !canNext2) return;
                s.wizardNext();
              }}
              className="text-[12.5px] font-bold text-white py-2.5 px-4.5 rounded-lg cursor-pointer"
              style={{ background: canNext2 || step !== 2 ? ACCENT_COLOR : "#C7C2FA" }}
            >
              Next
            </div>
          )}
          {step === 3 && (
            <div
              onClick={handleSubmit}
              className="text-[12.5px] font-bold text-white py-2.5 px-4.5 rounded-lg cursor-pointer"
              style={{ background: ACCENT_COLOR }}
            >
              Submit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
