'use client';

import { useEffect, useRef, useState } from 'react';
import type { ApiManifestEvent } from '@/lib/manifestEvents';

/** Subscribe to live manifest events via SSE (`/v1/tests/:id/events`). */
export function useManifestEvents(manifestId: string, enabled: boolean) {
  const [events, setEvents] = useState<ApiManifestEvent[]>([]);
  const [live, setLive] = useState(enabled);
  const [terminal, setTerminal] = useState<string | null>(null);
  const seenIds = useRef(new Set<number>());

  // Reset during render when the subscription target changes — the effect
  // below must not call setState synchronously (react-hooks/set-state-in-effect).
  const key = `${manifestId}:${enabled}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setEvents([]);
    setTerminal(null);
    setLive(enabled);
  }

  useEffect(() => {
    if (!enabled) return;
    seenIds.current.clear();

    const es = new EventSource(`/v1/tests/${manifestId}/events`);

    es.addEventListener('manifest_event', (ev) => {
      try {
        const row = JSON.parse((ev as MessageEvent).data) as {
          id: number;
          ts: string;
          kind: string;
          payload?: Record<string, unknown> | null;
        };
        if (seenIds.current.has(row.id)) return;
        seenIds.current.add(row.id);
        setEvents((prev) => [
          ...prev,
          {
            ts: row.ts,
            kind: row.kind,
            payload: row.payload ?? null,
          },
        ]);
      } catch {
        /* ignore malformed */
      }
    });

    es.addEventListener('terminal', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { status: string };
        setTerminal(data.status);
      } catch {
        /* ignore */
      }
      setLive(false);
      es.close();
    });

    es.onerror = () => {
      setLive(false);
      es.close();
    };

    return () => {
      setLive(false);
      es.close();
    };
  }, [manifestId, enabled]);

  return { events, live, terminal };
}
