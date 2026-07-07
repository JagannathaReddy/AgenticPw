'use client';

import { useEffect, useState } from 'react';
import { useManifestDetail } from '@/hooks/useManifestDetail';
import { useManifestEvents } from '@/hooks/useManifestEvents';
import { mapManifestEvents, dotColor, type ApiManifestEvent } from '@/lib/manifestEvents';
import { ACCENT_COLOR } from '@/lib/meta';
import type { ManifestRow } from '@/lib/types';

export default function TimelineTab({ manifest }: { manifest: ManifestRow }) {
  const { detail, loading, error } = useManifestDetail(manifest.id);
  const isRunningNow = manifest.raw.status === 'running' || manifest.raw.status === 'created';
  const { events: liveEvents, live, terminal } = useManifestEvents(manifest.id, isRunningNow);

  const baseEvents = detail
    ? mapManifestEvents(detail.events as ApiManifestEvent[], detail.startedAt ?? detail.createdAt)
    : [];
  const liveMapped = liveEvents.length
    ? mapManifestEvents(
        liveEvents,
        detail?.startedAt ?? detail?.createdAt ?? liveEvents[0].ts,
      )
    : [];
  const events = isRunningNow && liveEvents.length ? [...baseEvents, ...liveMapped.slice(baseEvents.length)] : baseEvents;

  if (loading && !liveEvents.length) {
    return (
      <div className="bg-white border border-[#E4E6EB] rounded-xl py-8 text-center text-[#9CA3AF] text-[13px]">
        Loading timeline…
      </div>
    );
  }

  if (error && !events.length) {
    return (
      <div className="bg-white border border-[#E4E6EB] rounded-xl py-8 text-center text-[#DC2626] text-[13px]">
        {error}
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E4E6EB] rounded-xl py-1.5">
      {events.length === 0 && (
        <div className="py-8 text-center text-[#9CA3AF] text-[13px]">No events recorded yet.</div>
      )}
      {events.map((ev, i) => (
        <div key={i} className="flex gap-3 py-[11px] px-5.5 border-b border-[#F5F6F8] items-start">
          <span
            className="w-2 h-2 rounded-full mt-1.5 flex-none"
            style={{ background: dotColor(ev.kind) }}
          />
          <span className="font-mono text-[11.5px] text-[#9CA3AF] w-16 flex-none pt-px">{ev.time}</span>
          <div className="flex-1">
            <div className="text-[13px] font-semibold">{ev.stage}</div>
            <div className="text-[12px] text-[#6B7280] mt-0.5">{ev.detail}</div>
          </div>
          <span className="text-[11.5px] text-[#9CA3AF] tabular-nums">{ev.costDelta}</span>
        </div>
      ))}
      {isRunningNow && live && !terminal && (
        <div
          className="flex items-center gap-2 py-3 px-5.5 text-[12.5px] font-semibold"
          style={{ color: ACCENT_COLOR }}
        >
          <span
            className="w-[7px] h-[7px] rounded-full"
            style={{ background: ACCENT_COLOR, animation: 'pulse-dot 1.1s infinite' }}
          />
          Streaming live…
        </div>
      )}
      {terminal && (
        <div className="py-3 px-5.5 text-[12.5px] font-semibold text-[#6B7280]">
          Finished: {terminal}
        </div>
      )}
    </div>
  );
}
