'use client';

import { useConsoleStore } from '@/store/useConsoleStore';
import type { ManifestRow } from '@/lib/types';
import { ACCENT_COLOR } from '@/lib/meta';
import { useState } from 'react';

export default function FeedbackTab({ manifest }: { manifest: ManifestRow }) {
  const stats = useConsoleStore((s) => s.feedbackStats);
  const promoteFeedback = useConsoleStore((s) => s.promoteFeedback);
  const showToast = useConsoleStore((s) => s.showToast);
  const [promoteDraft, setPromoteDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasFeedback = !!manifest.raw.feedback;
  const isHeal = manifest.raw.flow === 'heal';

  const category = manifest.raw.category ?? '(unclassified)';
  const row = stats?.byCategory.find((r) => r.category === category);
  const acceptRate =
    row && row.total > 0 ? `${Math.round((row.ups / row.total) * 100)}%` : '—';

  const handlePromote = async (write: boolean) => {
    setBusy(true);
    try {
      const result = await promoteFeedback(manifest.id, write);
      setPromoteDraft(result.body);
      if (write) showToast(`Wrote ${result.target}`, 4000);
    } catch (err) {
      showToast((err as Error).message, 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="bg-white border border-[#E4E6EB] rounded-xl py-4 px-4.5">
        <div className="text-[11.5px] font-bold text-[#9CA3AF] uppercase">
          Accept rate — {manifest.categoryLabel} on {manifest.repo}
        </div>
        <div className="text-[22px] font-bold mt-1.5">{acceptRate}</div>
        {row && (
          <div className="text-[12px] text-[#9CA3AF] mt-1">
            {row.ups} helpful · {row.downs} not helpful · {row.total} total
          </div>
        )}
      </div>
      {hasFeedback && (
        <div className="bg-white border border-[#E4E6EB] rounded-xl py-4 px-4.5 flex gap-2.5">
          <span className="text-[18px]">{manifest.raw.feedback === 'up' ? '👍' : '👎'}</span>
          <div className="flex-1">
            <div className="text-[13px] font-semibold">
              {manifest.raw.feedback === 'up' ? 'Marked helpful' : 'Marked not helpful'}
            </div>
            <div className="text-[12.5px] text-[#4B5563] mt-0.5">
              {manifest.raw.feedbackNote ?? '—'}
            </div>
          </div>
        </div>
      )}
      {!hasFeedback && (
        <div className="py-[30px] text-center text-[#9CA3AF] text-[13px] bg-white border border-[#E4E6EB] rounded-xl">
          No feedback recorded on this manifest yet.
        </div>
      )}
      {isHeal && hasFeedback && (
        <div className="bg-white border border-[#E4E6EB] rounded-xl py-4 px-4.5">
          <div className="text-[13px] font-bold mb-1">Promote to eval corpus</div>
          <div className="text-[12px] text-[#9CA3AF] mb-3">
            Mirrors <code className="font-mono">agent feedback --promote</code>
          </div>
          <div className="flex gap-2">
            <div
              onClick={() => !busy && void handlePromote(false)}
              className="text-[12.5px] font-semibold text-[#4B5563] py-2 px-3.5 border border-[#E4E6EB] rounded-lg cursor-pointer"
            >
              Preview draft
            </div>
            <div
              onClick={() => !busy && void handlePromote(true)}
              className="text-[12.5px] font-bold text-white py-2 px-3.5 rounded-lg cursor-pointer"
              style={{ background: busy ? '#C7C2FA' : ACCENT_COLOR }}
            >
              Write to corpus
            </div>
          </div>
          {promoteDraft && (
            <pre className="mt-3 p-3 bg-[#14161B] text-[#D5D8DE] text-[11px] font-mono rounded-lg overflow-x-auto max-h-[280px]">
              {promoteDraft}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
