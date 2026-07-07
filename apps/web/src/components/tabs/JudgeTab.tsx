'use client';

import { useEffect, useState } from 'react';
import { readArtifactMatching } from '@/lib/artifacts';
import type { ManifestRow } from '@/lib/types';

export default function JudgeTab({ manifest }: { manifest: ManifestRow }) {
  const [log, setLog] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const judge =
        (await readArtifactMatching(manifest.id, /judge-output\.log$/i)) ??
        (await readArtifactMatching(manifest.id, /baseline\.stdout\.log$/i));
      setLog(judge?.content ?? null);
      setFileName(judge?.name ?? null);
      setLoading(false);
    })();
  }, [manifest.id]);

  const verdictOk = manifest.raw.status !== 'rejected';
  const exitMatch = log?.match(/exit\s*(?:code)?[:\s]*(\d+)/i);
  const exitCode = exitMatch?.[1] ?? (verdictOk ? '0' : '1');
  const judgeExitFg = exitCode === '0' ? '#16A34A' : '#DC2626';
  const judgeExitBg = exitCode === '0' ? '#DCFCE7' : '#FEE2E2';

  if (loading) {
    return <div className="text-[#9CA3AF] text-[13px] py-8 text-center">Loading judge output…</div>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      {fileName && (
        <div className="text-[12px] text-[#9CA3AF] font-mono">{fileName}</div>
      )}
      <div className="flex gap-3.5 items-center">
        <span
          className="text-[12.5px] font-bold py-[5px] px-3 rounded-lg"
          style={{ color: judgeExitFg, background: judgeExitBg }}
        >
          exit code {exitCode}
        </span>
      </div>
      <div className="bg-[#14161B] rounded-xl py-4 px-4.5 text-[#A9E6B8] font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap min-h-[120px]">
        {log ?? 'No judge output artifact yet.'}
      </div>
    </div>
  );
}
