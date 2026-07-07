"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useConsoleStore } from "@/store/useConsoleStore";
import { ACCENT_COLOR } from "@/lib/meta";

const STATUS_STYLE: Record<string, { fg: string; bg: string }> = {
  active: { fg: "#2563EB", bg: "#DBEAFE" },
  needs_you: { fg: "#D97706", bg: "#FEF3C7" },
  done: { fg: "#16A34A", bg: "#DCFCE7" },
  escalated: { fg: "#DC2626", bg: "#FEE2E2" },
  cancelled: { fg: "#6B7280", bg: "#EEF0F2" },
  failed: { fg: "#DC2626", bg: "#FEE2E2" },
};

export default function TeammatePage() {
  const router = useRouter();
  const assignments = useConsoleStore((s) => s.assignments);
  const repos = useConsoleStore((s) => s.repos);
  const refreshAssignments = useConsoleStore((s) => s.refreshAssignments);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    void refreshAssignments(undefined, filter === "all" ? undefined : filter);
  }, [filter, refreshAssignments]);

  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="flex flex-col gap-5 max-w-[1180px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold m-0">Teammate inbox</h1>
          <p className="text-[13px] text-[#6B7280] mt-1 mb-0">
            Assign work once — the teammate runs closed heal loops until done or escalation.
          </p>
        </div>
        <Link
          href="/teammate/assign"
          className="text-[13px] font-semibold text-white px-4 py-2 rounded-lg no-underline"
          style={{ background: ACCENT_COLOR }}
        >
          Assign work
        </Link>
      </div>

      <div className="flex gap-2">
        {["all", "active", "needs_you", "done"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={
              "text-[12px] font-semibold px-3 py-1.5 rounded-full border " +
              (filter === s
                ? "border-[#6D5EF0] bg-[#EEEBFE] text-[#6D5EF0]"
                : "border-[#E4E6EB] bg-white text-[#6B7280]")
            }
          >
            {s === "needs_you" ? "Needs you" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
        {assignments.length === 0 ? (
          <div className="p-8 text-center text-[#6B7280] text-[13px]">No assignments yet.</div>
        ) : (
          assignments.map((a) => {
            const style = STATUS_STYLE[a.status] ?? STATUS_STYLE.active;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => router.push(`/teammate/${a.id}`)}
                className="w-full text-left px-5 py-4 border-b border-[#EEF0F2] last:border-b-0 hover:bg-[#FAFAFB] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ color: style.fg, background: style.bg }}
                  >
                    {a.status.replace("_", " ")}
                  </span>
                  <span className="text-[13px] font-semibold flex-1">{a.title}</span>
                  <span className="text-[12px] text-[#6B7280]">{repoName(a.repo_id)}</span>
                </div>
                <div className="text-[12px] text-[#6B7280] mt-1">
                  {a.assignment_type} · manifest {a.manifest_id.slice(0, 8)} · {a.manifest_status}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
