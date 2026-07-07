"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConsoleStore } from "@/store/useConsoleStore";
import { buildRows, buildRepoRows, stewardReportsFromManifests } from "@/lib/selectors";
import InitRepoModal from "@/components/InitRepoModal";
import { ACCENT_COLOR } from "@/lib/meta";
import type { RepoProfile, TeammateRepoState } from "@/lib/types";

function readinessColor(label: TeammateRepoState["loopReadiness"]["label"]): { fg: string; bg: string } {
  if (label === "ready") return { fg: "#16A34A", bg: "#DCFCE7" };
  if (label === "partial") return { fg: "#D97706", bg: "#FEF3C7" };
  return { fg: "#DC2626", bg: "#FEE2E2" };
}

export default function ReposPage() {
  const router = useRouter();
  const manifests = useConsoleStore((s) => s.manifests);
  const repos = useConsoleStore((s) => s.repos);
  const runSteward = useConsoleStore((s) => s.runSteward);
  const onboardRepo = useConsoleStore((s) => s.onboardRepo);
  const fetchRepoProfile = useConsoleStore((s) => s.fetchRepoProfile);
  const fetchTeammateState = useConsoleStore((s) => s.fetchTeammateState);
  const submitRegressionAssignment = useConsoleStore((s) => s.submitRegressionAssignment);
  const showToast = useConsoleStore((s) => s.showToast);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [initOpen, setInitOpen] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, RepoProfile>>({});
  const [teammateStates, setTeammateStates] = useState<Record<string, TeammateRepoState>>({});
  const [loadingProfile, setLoadingProfile] = useState<Record<string, boolean>>({});
  const [loadingTeammate, setLoadingTeammate] = useState<Record<string, boolean>>({});
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});

  const rows = buildRows(manifests);
  const repoRows = buildRepoRows(repos, rows, stewardReportsFromManifests(manifests));

  const toggle = async (id: string) => {
    const willOpen = !expanded[id];
    setExpanded((s) => ({ ...s, [id]: willOpen }));
    if (willOpen && !profiles[id]) {
      setLoadingProfile((s) => ({ ...s, [id]: true }));
      try {
        const profile = await fetchRepoProfile(id);
        setProfiles((s) => ({ ...s, [id]: profile }));
      } catch (err) {
        showToast((err as Error).message, 4000);
      } finally {
        setLoadingProfile((s) => ({ ...s, [id]: false }));
      }
    }
    if (willOpen && !teammateStates[id]) {
      setLoadingTeammate((s) => ({ ...s, [id]: true }));
      try {
        const state = await fetchTeammateState(id);
        setTeammateStates((s) => ({ ...s, [id]: state }));
      } catch (err) {
        showToast((err as Error).message, 4000);
      } finally {
        setLoadingTeammate((s) => ({ ...s, [id]: false }));
      }
    }
  };

  async function assignRegression(repoId: string) {
    setAssigning((s) => ({ ...s, [repoId]: true }));
    try {
      const manifestId = await submitRegressionAssignment(repoId);
      showToast("Regression assigned — teammate is working.", 3000);
      router.push(`/manifest/${manifestId}`);
    } catch (err) {
      showToast((err as Error).message, 4000);
    } finally {
      setAssigning((s) => ({ ...s, [repoId]: false }));
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-[1180px]">
      <div className="flex justify-end">
        <div
          onClick={() => setInitOpen(true)}
          className="text-[12.5px] font-bold text-white py-2 px-3.5 rounded-lg cursor-pointer"
          style={{ background: ACCENT_COLOR }}
        >
          Register repo
        </div>
      </div>

      {repoRows.length === 0 && (
        <div className="bg-white border border-[#E4E6EB] rounded-xl p-10 text-center text-[#9CA3AF]">
          No repos registered — click Register repo or run{" "}
          <code className="font-mono">npm run agent -- init . --name my-repo</code>
        </div>
      )}

      {repoRows.map((r) => {
        const isOpen = !!expanded[r.id];
        const profile = profiles[r.id];
        const teammate = teammateStates[r.id];
        const readiness = teammate?.loopReadiness;
        const readinessStyle = readiness ? readinessColor(readiness.label) : null;
        return (
          <div key={r.id} className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
            <div
              onClick={() => void toggle(r.id)}
              className="flex items-center gap-3.5 py-4 px-5 cursor-pointer"
            >
              <span className="w-[9px] h-[9px] rounded-full flex-none" style={{ background: r.healthFg }} />
              <span className="text-[14.5px] font-bold flex-none">{r.label}</span>
              <span className="text-[12px] text-[#9CA3AF] font-mono truncate max-w-[280px]">{r.localPath}</span>
              <span className="text-[12px] text-[#9CA3AF]">
                {r.tests} tests · flaky {r.flaky} · broken {r.broken}
              </span>
              {readinessStyle && readiness && (
                <span
                  className="text-[11px] font-bold py-0.5 px-2 rounded-full"
                  style={{ color: readinessStyle.fg, background: readinessStyle.bg }}
                  title="Loop readiness"
                >
                  Loop {readiness.score}%
                </span>
              )}
              <div className="flex-1" />
              <span
                className="text-[11.5px] font-bold py-[3px] px-2.5 rounded-full"
                style={{ color: r.healthFg, background: r.healthBg }}
              >
                {r.healthLabel}
              </span>
              <span className="text-[12px] text-[#9CA3AF]">last steward run {r.lastReport}</span>
              <span className="text-[13px] text-[#9CA3AF]">{isOpen ? "▾" : "▸"}</span>
            </div>
            {isOpen && (
              <div className="px-5 pb-4.5 border-t border-[#EEF0F2]">
                <div className="flex gap-2.5 my-3.5 flex-wrap items-center">
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      void assignRegression(r.id);
                    }}
                    className="text-[12px] font-bold text-white py-1.5 px-3 rounded-lg cursor-pointer disabled:opacity-60"
                    style={{ background: ACCENT_COLOR, opacity: assigning[r.id] ? 0.6 : 1 }}
                  >
                    {assigning[r.id] ? "Assigning…" : "Assign regression"}
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      void runSteward(r.id).then((id) => router.push(`/manifest/${id}`));
                    }}
                    className="text-[12px] font-semibold text-[#4B5563] py-1.5 px-3 border border-[#E4E6EB] rounded-lg cursor-pointer"
                  >
                    Run Steward
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push("/settings");
                    }}
                    className="text-[12px] font-semibold text-[#4B5563] py-1.5 px-3 border border-[#E4E6EB] rounded-lg cursor-pointer"
                  >
                    Run Doctor
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      void onboardRepo(r.id).then((id) => router.push(`/manifest/${id}`));
                    }}
                    className="text-[12px] font-semibold text-[#4B5563] py-1.5 px-3 border border-[#E4E6EB] rounded-lg cursor-pointer"
                  >
                    Re-onboard
                  </div>
                  {r.stewardManifestId && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/manifest/${r.stewardManifestId}`);
                      }}
                      className="text-[12px] font-semibold text-[#4B5563] py-1.5 px-3 border border-[#E4E6EB] rounded-lg cursor-pointer"
                    >
                      Latest steward report
                    </div>
                  )}
                </div>

                {loadingTeammate[r.id] && (
                  <div className="text-[12px] text-[#9CA3AF] py-2">Loading loop readiness…</div>
                )}
                {teammate?.loopReadiness && (
                  <div className="mb-3.5 p-3 bg-[#FAFAFB] rounded-lg border border-[#EEF0F2]">
                    <div className="text-[11.5px] font-bold text-[#9CA3AF] uppercase mb-2">
                      Loop readiness · {teammate.loopReadiness.score}% ({teammate.loopReadiness.label})
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {teammate.loopReadiness.checks.map((c) => (
                        <div key={c.id} className="flex items-start gap-2 text-[12px]">
                          <span style={{ color: c.ok ? "#16A34A" : "#DC2626" }}>{c.ok ? "✓" : "✗"}</span>
                          <span className="font-semibold shrink-0">{c.label}</span>
                          <span className="text-[#6B7280]">{c.detail}</span>
                        </div>
                      ))}
                    </div>
                    {teammate.needsAttention.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#EEF0F2] text-[12px] text-[#92400E]">
                        {teammate.needsAttention.length} assignment(s) need you —{" "}
                        <span
                          className="underline cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push("/teammate");
                          }}
                        >
                          open inbox
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {loadingProfile[r.id] && (
                  <div className="text-[12px] text-[#9CA3AF] py-2">Loading profile…</div>
                )}
                {profile && (
                  <div className="mb-3.5 p-3 bg-[#FAFAFB] rounded-lg border border-[#EEF0F2]">
                    <div className="text-[11.5px] font-bold text-[#9CA3AF] uppercase mb-2">Repo profile</div>
                    <div className="text-[12px] text-[#4B5563] flex gap-4 flex-wrap">
                      <span>
                        Status: <b>{profile.status}</b>
                      </span>
                      {profile.confidence != null && (
                        <span>
                          Confidence: <b>{profile.confidence}</b>
                        </span>
                      )}
                      {profile.onboardedAt && (
                        <span>
                          Onboarded: <b>{new Date(profile.onboardedAt).toLocaleDateString()}</b>
                        </span>
                      )}
                    </div>
                    {profile.profile && (
                      <pre className="mt-2 text-[11px] font-mono text-[#6B7280] overflow-x-auto max-h-[120px]">
                        {JSON.stringify(profile.profile, null, 2).slice(0, 800)}
                      </pre>
                    )}
                  </div>
                )}

                <div className="text-[11.5px] font-bold text-[#9CA3AF] uppercase mb-2">Recent manifests</div>
                {r.recentManifests.length === 0 && (
                  <div className="text-[12px] text-[#9CA3AF] py-2">No manifests yet for this repo.</div>
                )}
                {r.recentManifests.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => router.push(`/manifest/${m.id}`)}
                    className="flex items-center gap-3 py-2 border-b border-[#F5F6F8] text-[12.5px] last:border-0 cursor-pointer"
                  >
                    <span
                      className="text-[10.5px] font-bold py-0.5 px-1.5 rounded-md"
                      style={{ color: m.flowFg, background: m.flowBg }}
                    >
                      {m.flowLabel}
                    </span>
                    <span className="font-mono text-[#6B7280]">{m.shortId}</span>
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{m.target}</span>
                    <span
                      className="text-[11px] font-bold py-0.5 px-2 rounded-full"
                      style={{ color: m.statusFg, background: m.statusBg }}
                    >
                      {m.statusLabel}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <InitRepoModal open={initOpen} onClose={() => setInitOpen(false)} />
    </div>
  );
}
