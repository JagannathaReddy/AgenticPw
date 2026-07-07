'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ManifestRow, StewardFailingTest, StewardReportPayload } from '@/lib/types';

function runsCell(statuses: string[] | undefined) {
  if (!statuses?.length) return '—';
  return statuses.map((s) => (s === 'passed' ? '✓' : s === 'skipped' ? '–' : '✗')).join(' ');
}

export default function StewardReportTab({ manifest }: { manifest: ManifestRow }) {
  const [data, setData] = useState<StewardReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void apiFetch<StewardReportPayload>(`/v1/tests/${manifest.id}/steward-report`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [manifest.id]);

  if (loading) {
    return (
      <div className="bg-white border border-[#E4E6EB] rounded-xl py-8 text-center text-[#9CA3AF] text-[13px]">
        Loading steward report…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-[#E4E6EB] rounded-xl py-8 px-5 text-[#DC2626] text-[13px]">
        {error}
      </div>
    );
  }

  if (!data) return null;

  if (data.status === 'rejected') {
    return (
      <div className="flex flex-col gap-3.5">
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl py-4 px-5">
          <div className="text-[13px] font-bold text-[#DC2626] mb-2">Steward rejected</div>
          <div className="text-[13px] text-[#14161B] whitespace-pre-wrap font-mono leading-relaxed">
            {data.reason ?? 'Unknown error'}
          </div>
          {data.category && (
            <div className="text-[12px] text-[#9CA3AF] mt-2">Category: {data.category}</div>
          )}
        </div>
      </div>
    );
  }

  const failing = (data.failing ?? []) as StewardFailingTest[];
  const summary = data.summary;

  return (
    <div className="flex flex-col gap-3.5">
      {summary && (
        <div className="bg-white border border-[#E4E6EB] rounded-xl p-5 flex gap-8 flex-wrap">
          <div>
            <div className="text-[11px] text-[#9CA3AF] font-bold">RUNS</div>
            <div className="text-[20px] font-bold">{summary.runs}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#9CA3AF] font-bold">HEALTHY</div>
            <div className="text-[20px] font-bold text-[#16A34A]">{summary.healthy}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#9CA3AF] font-bold">FLAKY</div>
            <div className="text-[20px] font-bold text-[#D97706]">{summary.flaky}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#9CA3AF] font-bold">BROKEN</div>
            <div className="text-[20px] font-bold text-[#DC2626]">{summary.alwaysFailing}</div>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#E4E6EB] rounded-xl overflow-hidden">
        <div className="py-3.5 px-5 border-b border-[#EEF0F2] text-[13.5px] font-bold">
          Failing tests ({failing.length})
        </div>
        {failing.length === 0 && (
          <div className="py-8 text-center text-[#9CA3AF] text-[13px]">
            All tests passed in every run.
          </div>
        )}
        {failing.map((t, i) => (
          <div key={i} className="py-3.5 px-5 border-b border-[#F5F6F8] last:border-0">
            <div className="flex items-start gap-3">
              <span
                className="text-[10.5px] font-bold py-0.5 px-2 rounded-full flex-none mt-0.5"
                style={{
                  color: t.verdict === 'flaky' ? '#D97706' : '#DC2626',
                  background: t.verdict === 'flaky' ? '#FEF3C7' : '#FEE2E2',
                }}
              >
                {t.verdict === 'flaky' ? 'Flaky' : 'Broken'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold font-mono truncate">{t.file}</div>
                <div className="text-[12.5px] text-[#4B5563] mt-0.5">{t.title}</div>
                <div className="flex gap-3 mt-1.5 text-[11.5px] text-[#9CA3AF]">
                  {t.category && <span>{t.category}</span>}
                  {t.runsSeen != null && (
                    <span>
                      {t.passCount}/{t.runsSeen} passed · runs {runsCell(t.statuses)}
                    </span>
                  )}
                </div>
                {t.errorHeads?.[0] && (
                  <div className="mt-2 text-[12px] text-[#DC2626] bg-[#FEF2F2] rounded-lg py-2 px-2.5 font-mono whitespace-pre-wrap break-all">
                    {t.errorHeads[0]}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
