"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";

interface ApiLlmCall {
  role: string;
  model: string;
  inTok: number;
  outTok: number;
  cost: number;
  latencyMs: number;
}

export default function LlmCallsTab({ manifestId }: { manifestId: string }) {
  const [calls, setCalls] = useState<ApiLlmCall[]>([]);

  useEffect(() => {
    void apiFetch<ApiLlmCall[]>(`/v1/tests/${manifestId}/llm-calls`).then(setCalls).catch(() => setCalls([]));
  }, [manifestId]);

  return (
    <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
      <div className="flex gap-3.5 py-2.5 px-4.5 border-b border-[#EEF0F2] text-[11px] font-bold text-[#9CA3AF] uppercase">
        <span className="w-[70px]">Role</span>
        <span className="flex-1">Model</span>
        <span className="w-[60px] text-right">In tok</span>
        <span className="w-[60px] text-right">Out tok</span>
        <span className="w-[60px] text-right">Cost</span>
        <span className="w-[60px] text-right">Latency</span>
      </div>
      {calls.length === 0 && (
        <div className="py-8 text-center text-[#9CA3AF] text-[13px]">No LLM calls recorded yet.</div>
      )}
      {calls.map((c, i) => (
        <div key={i} className="flex gap-3.5 py-[11px] px-4.5 border-b border-[#F5F6F8] text-[12.5px] items-center last:border-0">
          <span className="w-[70px] font-semibold">{c.role}</span>
          <span className="flex-1 font-mono text-[#6B7280]">{c.model}</span>
          <span className="w-[60px] text-right tabular-nums">{c.inTok}</span>
          <span className="w-[60px] text-right tabular-nums">{c.outTok}</span>
          <span className="w-[60px] text-right tabular-nums">{money(c.cost)}</span>
          <span className="w-[60px] text-right text-[#9CA3AF]">{(c.latencyMs / 1000).toFixed(1)}s</span>
        </div>
      ))}
    </div>
  );
}
