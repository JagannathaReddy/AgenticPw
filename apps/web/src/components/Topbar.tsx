"use client";

import { usePathname } from "next/navigation";
import { useConsoleStore } from "@/store/useConsoleStore";
import { money, shortId } from "@/lib/format";
import { ACCENT_COLOR } from "@/lib/meta";

const STATIC_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  manifests: "Manifests",
  repos: "Repos",
  steward: "Steward",
  batches: "Batches",
  feedback: "Feedback",
  settings: "Settings",
};

function usePageTitle(): string {
  const pathname = usePathname();
  const manifests = useConsoleStore((s) => s.manifests);

  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "manifest" && segments[1]) {
    const m = manifests.find((mm) => mm.id === segments[1]);
    return m ? `Manifest ${shortId(m.id)}` : "Manifest";
  }
  return STATIC_TITLES[segments[0]] || "Console";
}

export default function Topbar({ onOpenWizard }: { onOpenWizard: () => void }) {
  const title = usePageTitle();
  const costs = useConsoleStore((s) => s.costs);
  const costWeek = costs?.weekUSD ?? 0;

  return (
    <div className="h-14 flex-none flex items-center gap-3.5 px-6 bg-white border-b border-[#E4E6EB]">
      <div className="text-[15px] font-bold">{title}</div>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 py-1.5 px-3 bg-[#F5F6F8] rounded-lg text-[12.5px] text-[#4B5563]">
        <span>Cost this week</span>
        <span className="font-bold text-[#14161B] tabular-nums">{money(costWeek)}</span>
      </div>
      <button
        onClick={onOpenWizard}
        className="flex items-center gap-1.5 text-white text-[13px] font-semibold py-2 px-3.5 rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
        style={{ background: ACCENT_COLOR }}
      >
        <span>+ New</span>
      </button>
      <div className="w-[30px] h-[30px] rounded-full bg-[#E4E6EB] flex items-center justify-center text-[12px] font-bold text-[#4B5563]">
        QA
      </div>
    </div>
  );
}
