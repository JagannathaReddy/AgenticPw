"use client";

import { useEffect, useState } from "react";
import { useConsoleStore } from "@/store/useConsoleStore";
import { money } from "@/lib/format";
import { shortId } from "@/lib/format";

const SINCE_OPTIONS = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
];

export default function CostPage() {
  const repos = useConsoleStore((s) => s.repos);
  const costBreakdown = useConsoleStore((s) => s.costBreakdown);
  const fetchCostBreakdown = useConsoleStore((s) => s.fetchCostBreakdown);
  const [sinceHours, setSinceHours] = useState(24);
  const [repoId, setRepoId] = useState("");

  useEffect(() => {
    void fetchCostBreakdown(sinceHours, repoId || undefined);
  }, [sinceHours, repoId, fetchCostBreakdown]);

  const b = costBreakdown;

  return (
    <div className="flex flex-col gap-4 max-w-[1180px]">
      <div className="flex gap-3 items-center flex-wrap">
        <select
          value={sinceHours}
          onChange={(e) => setSinceHours(+e.target.value)}
          className="py-2 px-3 border border-[#E4E6EB] rounded-lg text-[13px] font-[inherit]"
        >
          {SINCE_OPTIONS.map((o) => (
            <option key={o.hours} value={o.hours}>
              Last {o.label}
            </option>
          ))}
        </select>
        <select
          value={repoId}
          onChange={(e) => setRepoId(e.target.value)}
          className="py-2 px-3 border border-[#E4E6EB] rounded-lg text-[13px] font-[inherit]"
        >
          <option value="">All repos</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {!b && (
        <div className="bg-white border border-[#E4E6EB] rounded-xl p-10 text-center text-[#9CA3AF]">
          Loading cost data…
        </div>
      )}

      {b && (
        <>
          <div className="bg-white border border-[#E4E6EB] rounded-xl p-5 flex gap-10 flex-wrap">
            <div>
              <div className="text-[11.5px] font-bold text-[#9CA3AF]">TOTAL SPEND</div>
              <div className="text-[22px] font-bold mt-1">{money(b.totalCost)}</div>
            </div>
            <div>
              <div className="text-[11.5px] font-bold text-[#9CA3AF]">LLM CALLS</div>
              <div className="text-[22px] font-bold mt-1">{b.callCount}</div>
            </div>
            <div>
              <div className="text-[11.5px] font-bold text-[#9CA3AF]">TOKENS</div>
              <div className="text-[22px] font-bold mt-1 tabular-nums">
                {(b.tokensIn + b.tokensOut).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
              <div className="py-3.5 px-5 border-b border-[#EEF0F2] text-[13.5px] font-bold">By role</div>
              {b.byRole.map((r) => (
                <div key={r.role} className="flex items-center py-2.5 px-5 border-b border-[#F5F6F8] text-[12.5px] last:border-0">
                  <span className="font-mono flex-1">{r.role}</span>
                  <span className="tabular-nums text-[#6B7280] w-16 text-right">{r.count}</span>
                  <span className="tabular-nums font-semibold w-20 text-right">{money(r.cost)}</span>
                </div>
              ))}
              {b.byRole.length === 0 && (
                <div className="py-8 text-center text-[#9CA3AF] text-[13px]">No calls in window.</div>
              )}
            </div>

            <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
              <div className="py-3.5 px-5 border-b border-[#EEF0F2] text-[13.5px] font-bold">By model</div>
              {b.byModel.map((r) => (
                <div key={r.model} className="flex items-center py-2.5 px-5 border-b border-[#F5F6F8] text-[12.5px] last:border-0">
                  <span className="font-mono flex-1 truncate">{r.model}</span>
                  <span className="tabular-nums text-[#6B7280] w-16 text-right">{r.count}</span>
                  <span className="tabular-nums font-semibold w-20 text-right">{money(r.cost)}</span>
                </div>
              ))}
            </div>
          </div>

          {b.topManifests.length > 0 && (
            <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
              <div className="py-3.5 px-5 border-b border-[#EEF0F2] text-[13.5px] font-bold">Top-spend manifests</div>
              {b.topManifests.map((m) => (
                <div key={m.id} className="flex items-center py-2.5 px-5 border-b border-[#F5F6F8] text-[12.5px] last:border-0">
                  <span className="font-mono text-[#6B7280] w-20">{shortId(m.id)}</span>
                  <span className="flex-1">{m.role}</span>
                  <span className="tabular-nums text-[#6B7280] w-16 text-right">{m.calls} calls</span>
                  <span className="tabular-nums font-semibold w-20 text-right">{money(m.cost)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
