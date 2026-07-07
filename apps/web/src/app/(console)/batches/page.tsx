"use client";

import { useRouter } from "next/navigation";
import { useConsoleStore } from "@/store/useConsoleStore";
import { buildRows, buildBatchRows } from "@/lib/selectors";
import { ACCENT_COLOR } from "@/lib/meta";

export default function BatchesPage() {
  const router = useRouter();
  const manifests = useConsoleStore((s) => s.manifests);
  const applyBatchAll = useConsoleStore((s) => s.applyBatchAll);
  const rows = buildRows(manifests);
  const batches = buildBatchRows(manifests, rows);

  return (
    <div className="flex flex-col gap-4 max-w-[1180px]">
      {batches.map((b) => {
        const maxCost = b.maxCost || 5;
        const costPct = Math.min(100, Math.round((b.raw.cost / maxCost) * 100)) + "%";
        const verifiedCount = b.children.filter((c) => c.raw.status === "accepted" && c.raw.hasPatch).length;
        return (
          <div key={b.id} className="bg-white border border-[#E4E6EB] rounded-xl p-5">
            <div className="flex items-center gap-3">
              <span
                className="font-mono text-[14px] font-bold cursor-pointer"
                onClick={() => router.push(`/manifest/${b.id}`)}
              >
                {b.shortId}
              </span>
              <span
                className="text-[11px] font-bold py-[3px] px-2.5 rounded-full"
                style={{ color: b.statusFg, background: b.statusBg }}
              >
                {b.statusLabel}
              </span>
              <span className="text-[12px] text-[#9CA3AF]">{b.repo}</span>
              <div className="flex-1" />
              <span className="text-[12.5px] text-[#4B5563]">
                {b.costLabel} / max ${maxCost.toFixed(2)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[#EEF0F2] my-3.5 overflow-hidden">
              <div className="h-full" style={{ background: ACCENT_COLOR, width: costPct }} />
            </div>
            {b.children.map((c) => (
              <div
                key={c.id}
                onClick={() => router.push(`/manifest/${c.id}`)}
                className="flex items-center gap-3 py-2 border-b border-[#F5F6F8] text-[12.5px] cursor-pointer last:border-0"
              >
                <span
                  className="text-[10.5px] font-bold py-0.5 px-1.5 rounded-md"
                  style={{ color: c.flowFg, background: c.flowBg }}
                >
                  {c.flowLabel}
                </span>
                <span className="font-mono text-[#6B7280]">{c.shortId}</span>
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{c.target}</span>
                <span
                  className="text-[11px] font-bold py-0.5 px-2 rounded-full"
                  style={{ color: c.statusFg, background: c.statusBg }}
                >
                  {c.statusLabel}
                </span>
              </div>
            ))}
            <div className="flex justify-end mt-3.5 items-center gap-3">
              <span className="text-[12px] text-[#9CA3AF]">{verifiedCount} verified</span>
              <div
                onClick={() => verifiedCount > 0 && void applyBatchAll(b.id)}
                className="text-[12.5px] font-bold text-white py-2 px-3.5 rounded-lg cursor-pointer"
                style={{ background: verifiedCount > 0 ? ACCENT_COLOR : "#C7C2FA" }}
              >
                Apply all verified
              </div>
            </div>
          </div>
        );
      })}
      {batches.length === 0 && (
        <div className="py-[60px] text-center text-[#9CA3AF] bg-white border border-[#E4E6EB] rounded-xl">
          No batch runs yet.
        </div>
      )}
    </div>
  );
}
