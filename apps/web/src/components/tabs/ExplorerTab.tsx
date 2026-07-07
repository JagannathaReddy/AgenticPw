'use client';

import { useEffect, useState } from 'react';
import { readArtifactMatching } from '@/lib/artifacts';
import { ACCENT_COLOR } from '@/lib/meta';
import type { ManifestRow } from '@/lib/types';

interface ExplorerResult {
  success?: boolean | null;
  message?: string | null;
  actions?: Array<{ type?: string; summary?: string; reasoning?: string; action?: string }>;
  durationMs?: number;
}

export default function ExplorerTab({ manifest }: { manifest: ManifestRow }) {
  const [data, setData] = useState<ExplorerResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void readArtifactMatching(manifest.id, /explorer-result\.json$/i)
      .then((file) => {
        if (!file) {
          setData(null);
          return;
        }
        try {
          setData(JSON.parse(file.content) as ExplorerResult);
        } catch {
          setData(null);
        }
      })
      .finally(() => setLoading(false));
  }, [manifest.id]);

  const verdictOk = data?.success ?? manifest.raw.status !== 'rejected';
  const verdictBg = verdictOk ? '#F0FDF4' : '#FEF2F2';
  const verdictBorder = verdictOk ? '#BBF7D0' : '#FECACA';
  const verdictFg = verdictOk ? '#15803D' : '#B91C1C';
  const actions = data?.actions ?? [];

  if (loading) {
    return <div className="text-[#9CA3AF] text-[13px] py-8 text-center">Loading explorer data…</div>;
  }

  if (!data) {
    return (
      <div className="bg-white border border-[#E4E6EB] rounded-xl py-8 text-center text-[#9CA3AF] text-[13px]">
        No explorer artifact for this manifest.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-xl py-4 px-4.5 flex items-center gap-3"
        style={{ background: verdictBg, border: `1px solid ${verdictBorder}` }}
      >
        <span className="text-[20px]">{verdictOk ? '✅' : '⚠️'}</span>
        <div>
          <div className="text-[13.5px] font-bold" style={{ color: verdictFg }}>
            {verdictOk ? 'Goal reached' : 'Goal not reached'}
          </div>
          <div className="text-[12.5px] text-[#4B5563] mt-0.5">
            {data.message ?? (verdictOk ? 'Explorer reported success.' : manifest.categoryLabel)}
          </div>
        </div>
      </div>
      <div className="bg-white border border-[#E4E6EB] rounded-xl py-4 px-4.5">
        <div className="text-[12.5px] font-bold text-[#6B7280] uppercase mb-2.5">Action trace</div>
        {actions.length === 0 && (
          <div className="text-[12px] text-[#9CA3AF]">No actions recorded.</div>
        )}
        {actions.map((ac, i) => (
          <div key={i} className="flex gap-2.5 py-2 border-b border-[#F5F6F8] text-[12.5px] last:border-0">
            <span className="w-5 text-[#9CA3AF] font-bold">{i + 1}</span>
            <span className="font-mono w-[120px] flex-none" style={{ color: ACCENT_COLOR }}>
              {ac.type ?? 'action'}
            </span>
            <span className="text-[#4B5563]">
              {ac.summary ?? ac.reasoning ?? ac.action ?? '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
