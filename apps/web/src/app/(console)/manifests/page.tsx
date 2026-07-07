"use client";

import { useRouter } from "next/navigation";
import { useConsoleStore } from "@/store/useConsoleStore";
import { buildRows, filterRows, repoFilterOptions } from "@/lib/selectors";
import { ACCENT_COLOR } from "@/lib/meta";
import type { Filters } from "@/lib/types";

const STATUSES: Filters["status"][] = ["all", "created", "running", "accepted", "applied", "rejected"];
const FLOWS: Filters["flow"][] = ["all", "add", "heal", "improve", "batch", "steward", "quarantine", "onboard"];
const STATUS_LABEL: Record<string, string> = {
  all: "All",
  created: "Created",
  running: "Running",
  accepted: "Accepted",
  applied: "Applied",
  rejected: "Rejected",
};
const FLOW_LABEL: Record<string, string> = {
  all: "All",
  add: "Add",
  heal: "Heal",
  improve: "Improve",
  batch: "Batch",
  steward: "Steward",
  quarantine: "Quarantine",
  onboard: "Onboard",
};

function optClass(active: boolean) {
  return active
    ? "text-[13px] font-semibold py-1.5 px-2.5 rounded-lg cursor-pointer bg-[#EEEBFE]"
    : "text-[13px] font-medium py-1.5 px-2.5 rounded-lg cursor-pointer text-[#4B5563]";
}

export default function ManifestsPage() {
  const router = useRouter();
  const manifests = useConsoleStore((s) => s.manifests);
  const repos = useConsoleStore((s) => s.repos);
  const filters = useConsoleStore((s) => s.filters);
  const setFilter = useConsoleStore((s) => s.setFilter);

  const repoOptions = repoFilterOptions(repos);

  const rows = filterRows(buildRows(manifests), filters);

  return (
    <div className="flex gap-5 items-start">
      {/* Filters */}
      <div className="w-[220px] flex-none bg-white border border-[#E4E6EB] rounded-xl p-[18px] flex flex-col gap-[18px]">
        <div>
          <div className="text-[11.5px] font-bold text-[#6B7280] uppercase tracking-wide mb-2">Search</div>
          <input
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="spec, URL, ID…"
            className="w-full box-border py-2 px-2.5 border border-[#E4E6EB] rounded-[7px] text-[13px] outline-none"
          />
        </div>
        <div>
          <div className="text-[11.5px] font-bold text-[#6B7280] uppercase tracking-wide mb-2">Status</div>
          <div className="flex flex-col gap-1">
            {STATUSES.map((v) => (
              <div
                key={v}
                onClick={() => setFilter("status", v)}
                className={optClass(filters.status === v)}
                style={filters.status === v ? { color: ACCENT_COLOR } : undefined}
              >
                {STATUS_LABEL[v]}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11.5px] font-bold text-[#6B7280] uppercase tracking-wide mb-2">Flow</div>
          <div className="flex flex-col gap-1">
            {FLOWS.map((v) => (
              <div
                key={v}
                onClick={() => setFilter("flow", v)}
                className={optClass(filters.flow === v)}
                style={filters.flow === v ? { color: ACCENT_COLOR } : undefined}
              >
                {FLOW_LABEL[v]}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11.5px] font-bold text-[#6B7280] uppercase tracking-wide mb-2">Repo</div>
          <div className="flex flex-col gap-1">
            {repoOptions.map((v) => (
              <div
                key={v}
                onClick={() => setFilter("repo", v)}
                className={optClass(filters.repo === v)}
                style={filters.repo === v ? { color: ACCENT_COLOR } : undefined}
              >
                {v === "all" ? "All" : v}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3.5 py-2.5 px-5 border-b border-[#EEF0F2] text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wide">
          <span className="w-14">Flow</span>
          <span className="w-[78px]">ID</span>
          <span className="flex-1">Spec / URL</span>
          <span className="w-[90px]">Category</span>
          <span className="w-[60px] text-right">Time</span>
          <span className="w-[70px] text-right">Cost</span>
          <span className="w-11 text-center">FB</span>
          <span className="w-[74px] text-center">Status</span>
          <span className="w-16 text-right">Age</span>
        </div>
        {rows.map((m) => (
          <div
            key={m.id}
            onClick={() => router.push(`/manifest/${m.id}`)}
            className="flex items-center gap-3.5 py-3 px-5 border-b border-[#F5F6F8] cursor-pointer text-[13px] hover:bg-[#FAFAFB]"
          >
            <span
              className="w-14 text-[11px] font-bold py-[3px] px-2 rounded-md text-center"
              style={{ color: m.flowFg, background: m.flowBg }}
            >
              {m.flowLabel}
            </span>
            <span className="w-[78px] font-mono text-[12.5px] text-[#6B7280]">{m.shortId}</span>
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{m.target}</span>
            <span className="w-[90px] text-[12px] text-[#6B7280] overflow-hidden text-ellipsis whitespace-nowrap">
              {m.categoryLabel}
            </span>
            <span className="w-[60px] text-right text-[12px] text-[#9CA3AF] tabular-nums">
              {m.durationLabel}
            </span>
            <span className="w-[70px] text-right text-[12px] text-[#6B7280] tabular-nums">
              {m.costLabel}
            </span>
            <span className="w-11 text-center text-[14px]">
              {m.feedback === "up" ? "👍" : m.feedback === "down" ? "👎" : "—"}
            </span>
            <span className="w-[74px] text-center">
              <span
                className="text-[11px] font-bold py-[3px] px-[9px] rounded-full"
                style={{ color: m.statusFg, background: m.statusBg }}
              >
                {m.statusLabel}
              </span>
            </span>
            <span className="w-16 text-right text-[12px] text-[#9CA3AF]">{m.relTime}</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="py-[60px] px-5 text-center text-[#9CA3AF] text-[13.5px]">
            No manifests match these filters.
          </div>
        )}
      </div>
    </div>
  );
}
