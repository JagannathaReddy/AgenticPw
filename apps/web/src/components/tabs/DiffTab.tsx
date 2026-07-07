"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ManifestRow } from "@/lib/types";

interface DiffFile {
  file: string;
  diff: string;
}

function parseDiffLines(diff: string) {
  return diff.split("\n").map((line, i) => {
    let variant: "context" | "removed" | "added" = "context";
    if (line.startsWith("-") && !line.startsWith("---")) variant = "removed";
    else if (line.startsWith("+") && !line.startsWith("+++")) variant = "added";
    return { num: i + 1, text: line, variant };
  });
}

export default function DiffTab({ manifest }: { manifest: ManifestRow }) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const scopeWarning = manifest.raw.flow === "batch";

  useEffect(() => {
    void apiFetch<DiffFile[]>(`/v1/tests/${manifest.id}/diff`).then(setFiles).catch(() => setFiles([]));
  }, [manifest.id]);

  const lines = files.length ? parseDiffLines(files[0].diff) : [];

  return (
    <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
      <div className="py-2.5 px-4.5 border-b border-[#EEF0F2] font-mono text-[12.5px] text-[#6B7280]">
        {files[0]?.file ?? manifest.target}
      </div>
      {lines.length === 0 && (
        <div className="py-8 text-center text-[#9CA3AF] text-[13px]">No patch diff available yet.</div>
      )}
      {lines.map((dl, i) => (
        <div
          key={i}
          className="py-0.5 px-4.5 font-mono text-[12.5px] whitespace-pre"
          style={
            dl.variant === "removed"
              ? { background: "#FEF2F2", color: "#B91C1C" }
              : dl.variant === "added"
              ? { background: "#F0FDF4", color: "#15803D" }
              : undefined
          }
        >
          <span className="inline-block w-[34px] text-right mr-3.5 opacity-40 select-none">{dl.num}</span>
          <span>{dl.text}</span>
        </div>
      ))}
      {scopeWarning && (
        <div className="flex gap-2 items-center py-3 px-4.5 bg-[#FEF3C7] text-[#92400E] text-[12.5px] font-semibold">
          ⚠ This diff touches files outside the tracked spec — review carefully.
        </div>
      )}
    </div>
  );
}
