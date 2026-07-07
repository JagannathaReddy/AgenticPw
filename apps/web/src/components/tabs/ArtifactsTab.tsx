"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiFetchText } from "@/lib/api";
import { ACCENT_COLOR } from "@/lib/meta";

interface ArtifactEntry {
  name: string;
  size: number;
}

export default function ArtifactsTab({ manifestId }: { manifestId: string }) {
  const [files, setFiles] = useState<ArtifactEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [content, setContent] = useState("");

  useEffect(() => {
    void apiFetch<ArtifactEntry[]>(`/v1/tests/${manifestId}/artifacts`)
      .then((list) => {
        setFiles(list);
        setSelected(0);
      })
      .catch(() => setFiles([]));
  }, [manifestId]);

  useEffect(() => {
    const name = files[selected]?.name;
    if (!name) return;
    let cancelled = false;
    void apiFetchText(`/v1/tests/${manifestId}/artifacts/file?name=${encodeURIComponent(name)}`)
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setContent("[unable to load artifact]");
      });
    return () => {
      cancelled = true;
    };
  }, [manifestId, files, selected]);

  return (
    <div className="flex gap-3.5">
      <div className="w-[280px] flex-none bg-white border border-[#E4E6EB] rounded-xl p-2">
        {files.length === 0 && (
          <div className="py-4 px-3 text-[12px] text-[#9CA3AF]">No artifacts yet.</div>
        )}
        {files.map((f, i) => (
          <div
            key={f.name}
            onClick={() => setSelected(i)}
            className="py-2.5 px-3 text-[12.5px] rounded-lg cursor-pointer"
            style={
              selected === i
                ? { background: "#EEEBFE", color: ACCENT_COLOR, fontWeight: 600 }
                : { color: "#4B5563" }
            }
          >
            📄 {f.name}
          </div>
        ))}
      </div>
      <div className="flex-1 bg-white border border-[#E4E6EB] rounded-xl py-4 px-4.5">
        <div className="font-mono text-[12px] text-[#4B5563] whitespace-pre-wrap">{files[selected] ? content : ""}</div>
      </div>
    </div>
  );
}
