"use client";

import { useRouter } from "next/navigation";
import { useConsoleStore } from "@/store/useConsoleStore";
import { buildRows, buildRepoRows, dashboardSummary, recentRows, stewardReportsFromManifests } from "@/lib/selectors";
import { ACCENT_COLOR } from "@/lib/meta";

export default function DashboardPage() {
  const router = useRouter();
  const manifests = useConsoleStore((s) => s.manifests);
  const repos = useConsoleStore((s) => s.repos);
  const costs = useConsoleStore((s) => s.costs);
  const settings = useConsoleStore((s) => s.settings);
  const teammateSummary = useConsoleStore((s) => s.teammateSummary);

  const rows = buildRows(manifests);
  const repoRows = buildRepoRows(repos, rows, stewardReportsFromManifests(manifests));
  const summary = dashboardSummary(manifests, repoRows, costs ?? undefined);
  const recent = recentRows(rows);

  const needsAttention = teammateSummary?.needsAttention ?? [];
  const activeTeammate = teammateSummary?.activeCount ?? 0;

  const doctorOk = settings?.checks.every((c) => c.ok) ?? false;
  const costPoints =
    costs?.days?.length && costs.days.length > 1
      ? costs.days
          .map((d, i, arr) => {
            const x = (i / (arr.length - 1)) * 140;
            const max = Math.max(...arr.map((p) => p.usd), 0.0001);
            const y = 30 - (d.usd / max) * 26;
            return `${x},${y}`;
          })
          .join(' ')
      : null;

  return (
    <div className="flex flex-col gap-5 max-w-[1180px]">
      <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-4">
        {/* Suite health */}
        <div className="bg-white border border-[#E4E6EB] rounded-xl py-[18px] px-5">
          <div className="text-[12.5px] font-bold text-[#6B7280] uppercase tracking-wide mb-3.5">
            Suite health
          </div>
          <div className="flex flex-col gap-2.5">
            {summary.repos.map((r) => (
              <div key={r.name} className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: r.healthFg }} />
                <span className="text-[13.5px] font-semibold flex-1">{r.label}</span>
                <span className="text-[12px] text-[#6B7280]">{r.tests} tests</span>
                <span
                  className="text-[11.5px] font-bold py-0.5 px-2 rounded-full"
                  style={{ color: r.healthFg, background: r.healthBg }}
                >
                  {r.healthLabel}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Cost */}
        <div
          onClick={() => router.push("/cost")}
          className="bg-white border border-[#E4E6EB] rounded-xl py-[18px] px-5 cursor-pointer"
        >
          <div className="text-[12.5px] font-bold text-[#6B7280] uppercase tracking-wide mb-2.5">Cost</div>
          <div className="text-2xl font-bold tabular-nums">{summary.costWeekLabel}</div>
          <div className="text-[12px] text-[#9CA3AF] mb-2.5">
            this week · {summary.costMonthLabel} this month
          </div>
          <svg width="100%" height="34" viewBox="0 0 140 34" preserveAspectRatio="none">
            {costPoints ? (
              <polyline points={costPoints} fill="none" stroke={ACCENT_COLOR} strokeWidth={2} />
            ) : (
              <text x="0" y="20" fill="#9CA3AF" fontSize="11">
                No spend data yet
              </text>
            )}
          </svg>
        </div>

        {/* Pending feedback / doctor */}
        <div className="bg-white border border-[#E4E6EB] rounded-xl py-[18px] px-5 flex flex-col gap-3">
          <div>
            <div className="text-[12.5px] font-bold text-[#6B7280] uppercase tracking-wide">
              Pending feedback
            </div>
            <div className="text-2xl font-bold mt-1">{summary.pendingFeedback}</div>
          </div>
          <div className="h-px bg-[#EEF0F2]" />
          <div className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: doctorOk ? '#16A34A' : '#D97706' }}>
            <span className="w-[7px] h-[7px] rounded-full" style={{ background: doctorOk ? '#16A34A' : '#D97706' }} />
            Doctor: {doctorOk ? 'all checks passing' : 'needs attention'}
          </div>
        </div>
      </div>

      {(needsAttention.length > 0 || activeTeammate > 0) && (
        <div
          onClick={() => router.push("/teammate")}
          className="bg-white border border-[#FDE68A] rounded-xl py-4 px-5 cursor-pointer"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[12.5px] font-bold text-[#92400E] uppercase tracking-wide">
              Needs your attention
            </div>
            {activeTeammate > 0 && (
              <span className="text-[11px] font-semibold text-[#6B7280]">
                · {activeTeammate} active assignment{activeTeammate === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {needsAttention.length === 0 ? (
            <div className="text-[13px] text-[#6B7280]">Teammate is working — no escalations yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {needsAttention.slice(0, 3).map((a) => {
                const esc = a.escalation as { category?: string; reason?: string } | null;
                return (
                  <div key={a.id} className="flex items-start gap-3 text-[13px]">
                    <span className="font-semibold shrink-0">{a.repoName}</span>
                    <span className="text-[#6B7280] flex-1 truncate">{a.title}</span>
                    <span className="text-[#92400E] text-[12px] shrink-0 max-w-[240px] truncate">
                      {esc?.category ?? a.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div
          onClick={() => router.push("/manifests")}
          className="bg-white border border-[#E4E6EB] rounded-xl py-4 px-5 cursor-pointer"
        >
          <div className="text-[12px] text-[#6B7280] font-semibold">Heals applied this week</div>
          <div className="text-[22px] font-bold text-[#16A34A] mt-1">{summary.appliedCount}</div>
        </div>
        <div
          onClick={() => router.push("/manifests")}
          className="bg-white border border-[#E4E6EB] rounded-xl py-4 px-5 cursor-pointer"
        >
          <div className="text-[12px] text-[#6B7280] font-semibold">Refused this week</div>
          <div className="text-[22px] font-bold text-[#DC2626] mt-1">{summary.rejectedCount}</div>
        </div>
      </div>

      {/* Recent manifests */}
      <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
        <div className="flex items-center py-3.5 px-5 border-b border-[#EEF0F2]">
          <div className="text-[13.5px] font-bold">Recent manifests</div>
          <div className="flex-1" />
          <div
            onClick={() => router.push("/manifests")}
            className="text-[12.5px] font-semibold cursor-pointer"
            style={{ color: ACCENT_COLOR }}
          >
            View all →
          </div>
        </div>
        {recent.map((m) => (
          <div
            key={m.id}
            onClick={() => router.push(`/manifest/${m.id}`)}
            className="flex items-center gap-3.5 py-3 px-5 border-b border-[#F5F6F8] cursor-pointer hover:bg-[#FAFAFB]"
          >
            <span
              className="text-[11px] font-bold py-[3px] px-2 rounded-md w-14 text-center"
              style={{ color: m.flowFg, background: m.flowBg }}
            >
              {m.flowLabel}
            </span>
            <span className="font-mono text-[12.5px] text-[#6B7280] w-[78px]">{m.shortId}</span>
            <span className="text-[13px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {m.target}
            </span>
            <span className="text-[12px] text-[#9CA3AF] w-[72px] text-right tabular-nums">
              {m.costLabel}
            </span>
            <span
              className="text-[11px] font-bold py-[3px] px-[9px] rounded-full w-[66px] text-center"
              style={{ color: m.statusFg, background: m.statusBg }}
            >
              {m.statusLabel}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
