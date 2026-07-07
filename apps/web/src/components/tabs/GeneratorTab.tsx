'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { readArtifactMatching } from '@/lib/artifacts';
import { money } from '@/lib/format';
import type { ManifestRow } from '@/lib/types';

interface LlmRow {
  role: string;
  model: string;
  inTok: number;
  outTok: number;
  cost: number;
  latencyMs: number;
}

export default function GeneratorTab({ manifest }: { manifest: ManifestRow }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      readArtifactMatching(manifest.id, /generator-raw\.md$/i),
      apiFetch<LlmRow[]>(`/v1/tests/${manifest.id}/llm-calls`).catch(() => [] as LlmRow[]),
    ]).then(([file, calls]) => {
      setRaw(file?.content ?? null);
      setLlm(calls.find((c) => c.role === 'generate' || c.role === 'generator') ?? calls[0] ?? null);
      setLoading(false);
    });
  }, [manifest.id]);

  if (loading) {
    return <div className="text-[#9CA3AF] text-[13px] py-8 text-center">Loading generator output…</div>;
  }

  const tokens = llm ? llm.inTok + llm.outTok : null;
  const latency = llm ? `${(llm.latencyMs / 1000).toFixed(1)}s` : '—';

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex gap-3.5">
        <div className="flex-1 bg-white border border-[#E4E6EB] rounded-xl py-4 px-4.5">
          <div className="text-[11.5px] font-bold text-[#9CA3AF]">MODEL / TOKENS</div>
          <div className="text-[13.5px] font-semibold mt-1">
            {llm ? `${llm.model} · ${tokens?.toLocaleString()} tok · ${latency}` : '—'}
          </div>
        </div>
        <div className="flex-1 bg-white border border-[#E4E6EB] rounded-xl py-4 px-4.5">
          <div className="text-[11.5px] font-bold text-[#9CA3AF]">COST</div>
          <div className="text-[13.5px] font-semibold mt-1">{llm ? money(llm.cost) : '—'}</div>
        </div>
      </div>
      <div className="bg-[#14161B] rounded-xl py-4 px-4.5 text-[#D5D8DE] font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap min-h-[120px]">
        {raw ?? 'No generator output artifact yet.'}
      </div>
    </div>
  );
}
