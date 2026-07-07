"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCENT_COLOR } from "@/lib/meta";
import { useConsoleStore } from "@/store/useConsoleStore";

function WorkspaceName() {
  const workspace = useConsoleStore((s) => s.settings?.workspace ?? "—");
  return <div className="text-[12.5px] text-[#D5D8DE] font-semibold">{workspace}</div>;
}

const NAV_ITEMS: { key: string; label: string; href: string; icon: React.ReactNode }[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1"></rect>
        <rect x="14" y="3" width="7" height="5" rx="1"></rect>
        <rect x="14" y="12" width="7" height="9" rx="1"></rect>
        <rect x="3" y="16" width="7" height="5" rx="1"></rect>
      </svg>
    ),
  },
  {
    key: "teammate",
    label: "Teammate",
    href: "/teammate",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="4"></circle>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"></path>
      </svg>
    ),
  },
  {
    key: "manifests",
    label: "Manifests",
    href: "/manifests",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h16v4H4z"></path>
        <path d="M4 11h16v4H4z"></path>
        <path d="M4 18h10"></path>
      </svg>
    ),
  },
  {
    key: "repos",
    label: "Repos",
    href: "/repos",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19V6a2 2 0 0 1 2-2h9l5 5v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path>
        <path d="M14 4v5h5"></path>
      </svg>
    ),
  },
  {
    key: "steward",
    label: "Steward",
    href: "/steward",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z"></path>
      </svg>
    ),
  },
  {
    key: "batches",
    label: "Batches",
    href: "/batches",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1"></rect>
        <rect x="14" y="3" width="7" height="7" rx="1"></rect>
        <rect x="3" y="14" width="7" height="7" rx="1"></rect>
        <rect x="14" y="14" width="7" height="7" rx="1"></rect>
      </svg>
    ),
  },
  {
    key: "feedback",
    label: "Feedback",
    href: "/feedback",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 11v6M7 11l-2 1v5l2 1M17 11v6M17 11l2 1v5l-2 1M7 11h10M7 17h10"></path>
      </svg>
    ),
  },
  {
    key: "cost",
    label: "Cost",
    href: "/cost",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
      </svg>
    ),
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.14.64.6 1.16 1.24 1.4.2.08.42.12.64.12H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.48z"></path>
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  const isActive = (key: string) => {
    if (key === "manifests") return pathname.startsWith("/manifests") || pathname.startsWith("/manifest/");
    if (key === "teammate") return pathname.startsWith("/teammate");
    return pathname.startsWith(`/${key}`);
  };

  return (
    <div className="w-[224px] flex-none bg-[#15171C] flex flex-col p-4 px-3 box-border">
      <div className="flex items-center gap-2 px-2 pt-2 pb-5 text-white">
        <div
          className="w-[26px] h-[26px] rounded-[7px] flex-none"
          style={{ background: `linear-gradient(135deg, ${ACCENT_COLOR}, #9A8CFF)` }}
        />
        <div className="font-bold text-[14.5px] tracking-tight">AgenticPw</div>
      </div>

      <div className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.key);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={
                "flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] no-underline transition-colors " +
                (active
                  ? "font-semibold text-white bg-[#24262D]"
                  : "font-medium text-[#9CA3AF] hover:bg-[#1F2229]")
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-auto pt-2.5 px-2 border-t border-[#24262D]">
        <div className="text-[11px] text-[#6B7280]">Workspace</div>
        <WorkspaceName />
      </div>
    </div>
  );
}
