"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useConsoleStore } from "@/store/useConsoleStore";
import type { QaAssignment } from "@/lib/types";

interface PhaseRow {
  name: string;
  outcome: string;
  costUSD?: number;
  attempt?: number;
  manifestId?: string;
}

function parsePhases(loopState: Record<string, unknown> | undefined): PhaseRow[] {
  const raw = loopState?.phases;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is PhaseRow => typeof p === "object" && p !== null && "name" in p);
}

export default function TeammateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const cancelAssignment = useConsoleStore((s) => s.cancelAssignment);
  const [assignment, setAssignment] = useState<QaAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<QaAssignment>(`/v1/assignments/${params.id}`)
      .then(setAssignment)
      .catch((err: Error) => setError(err.message));
  }, [params.id]);

  if (error) {
    return <div className="text-[#DC2626] text-[13px]">{error}</div>;
  }
  if (!assignment) {
    return <div className="text-[#6B7280] text-[13px]">Loading assignment…</div>;
  }

  const escalation = assignment.escalation as { category?: string; reason?: string } | null;
  const phases = parsePhases(assignment.loop_state);

  return (
    <div className="max-w-[760px] flex flex-col gap-5">
      <button
        type="button"
        onClick={() => router.push("/teammate")}
        className="text-[13px] text-[#6D5EF0] bg-transparent border-0 p-0 cursor-pointer w-fit"
      >
        ← Back to inbox
      </button>

      <div className="bg-white border border-[#E4E6EB] rounded-xl p-5 flex flex-col gap-3">
        <h1 className="text-[20px] font-bold m-0">{assignment.title}</h1>
        <div className="text-[13px] text-[#6B7280]">
          {assignment.assignment_type} · {assignment.status} · manifest{" "}
          <Link href={`/manifest/${assignment.manifest_id}`} className="text-[#6D5EF0]">
            {assignment.manifest_id.slice(0, 8)}
          </Link>
        </div>

        {escalation?.reason && (
          <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-lg p-3 text-[13px]">
            <strong>{escalation.category ?? "escalation"}:</strong> {escalation.reason}
          </div>
        )}

        {phases.length > 0 && (
          <div className="flex flex-col gap-2 pt-1">
            <h2 className="text-[14px] font-semibold m-0">Loop phases</h2>
            <ol className="m-0 p-0 list-none flex flex-col gap-2">
              {phases.map((phase, i) => (
                <li
                  key={`${phase.name}-${i}`}
                  className="flex items-center justify-between gap-3 text-[13px] border border-[#E4E6EB] rounded-lg px-3 py-2"
                >
                  <span>
                    <strong>{phase.name}</strong>
                    {phase.attempt !== undefined ? ` (${phase.attempt})` : ""}
                    {" · "}
                    <span className={phase.outcome === "passed" || phase.outcome === "succeeded" ? "text-[#059669]" : "text-[#DC2626]"}>
                      {phase.outcome}
                    </span>
                  </span>
                  <span className="text-[#6B7280] shrink-0">
                    {phase.costUSD !== undefined ? `$${phase.costUSD.toFixed(4)}` : ""}
                    {phase.manifestId ? (
                      <>
                        {" · "}
                        <Link href={`/manifest/${phase.manifestId}`} className="text-[#6D5EF0]">
                          {phase.manifestId.slice(0, 8)}
                        </Link>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Link
            href={`/manifest/${assignment.manifest_id}`}
            className="text-[13px] font-semibold px-3 py-2 rounded-lg border border-[#E4E6EB] no-underline text-[#111827]"
          >
            View manifest timeline
          </Link>
          {["active", "needs_you"].includes(assignment.status) && (
            <button
              type="button"
              onClick={() => void cancelAssignment(assignment.id).then(() => router.push("/teammate"))}
              className="text-[13px] font-semibold px-3 py-2 rounded-lg border border-[#FECACA] text-[#DC2626] bg-white cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
