"use client";

import { useConsoleStore } from "@/store/useConsoleStore";
import { buildRows, buildFeedbackRows } from "@/lib/selectors";
import { shortId, relTime } from "@/lib/format";
import { FLOW_META } from "@/lib/meta";

export default function FeedbackPage() {
  const manifests = useConsoleStore((s) => s.manifests);
  const stats = useConsoleStore((s) => s.feedbackStats);

  const rows = buildFeedbackRows(buildRows(manifests));
  const total = stats?.byCategory.reduce((sum, r) => sum + r.total, 0) ?? 0;
  const upCount = stats?.byCategory.reduce((sum, r) => sum + r.ups, 0) ?? 0;
  const downCount = stats?.byCategory.reduce((sum, r) => sum + r.downs, 0) ?? 0;
  const recent = stats?.recent ?? [];

  return (
    <div className="flex flex-col gap-4 max-w-[1180px]">
      <div className="bg-white border border-[#E4E6EB] rounded-xl p-5 flex gap-10">
        <div>
          <div className="text-[11.5px] font-bold text-[#9CA3AF]">TOTAL FEEDBACK</div>
          <div className="text-[22px] font-bold mt-1">{total}</div>
        </div>
        <div>
          <div className="text-[11.5px] font-bold text-[#9CA3AF]">HELPFUL</div>
          <div className="text-[22px] font-bold text-[#16A34A] mt-1">{upCount}</div>
        </div>
        <div>
          <div className="text-[11.5px] font-bold text-[#9CA3AF]">NOT HELPFUL</div>
          <div className="text-[22px] font-bold text-[#DC2626] mt-1">{downCount}</div>
        </div>
      </div>

      <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
        <div className="py-3.5 px-5 border-b border-[#EEF0F2] text-[13.5px] font-bold">Notes gallery</div>
        {recent.map((r) => {
          const fm = FLOW_META.heal;
          return (
            <div key={r.manifest_id + r.created_at} className="flex gap-3.5 py-3.5 px-5 border-b border-[#F5F6F8] last:border-0">
              <span className="text-[18px]">{r.verdict === "up" ? "👍" : "👎"}</span>
              <div className="flex-1">
                <div className="flex gap-2.5 items-center">
                  <span className="font-mono text-[12.5px] text-[#6B7280]">{shortId(r.manifest_id)}</span>
                  <span
                    className="text-[11px] font-bold py-0.5 px-2 rounded-md"
                    style={{ color: fm.fg, background: fm.bg }}
                  >
                    Heal
                  </span>
                  <span className="text-[12px] text-[#9CA3AF]">
                    {r.category ?? "—"} · {r.test_path ?? "—"}
                  </span>
                </div>
                <div className="text-[13px] text-[#14161B] mt-1">{r.note ?? "—"}</div>
              </div>
              <span className="text-[11.5px] text-[#9CA3AF] whitespace-nowrap">{relTime(new Date(r.created_at).getTime())}</span>
            </div>
          );
        })}
        {recent.length === 0 && rows.length === 0 && (
          <div className="py-10 text-center text-[#9CA3AF]">No feedback yet.</div>
        )}
      </div>
    </div>
  );
}
