'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ApiManifestEvent } from '@/lib/manifestEvents';

export interface ManifestDetail {
  id: string;
  role: string;
  status: string;
  goal: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  events: ApiManifestEvent[];
}

export function useManifestDetail(manifestId: string) {
  const [detail, setDetail] = useState<ManifestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset during render when the target changes — the effect below must not
  // call setState synchronously (react-hooks/set-state-in-effect).
  const [prevId, setPrevId] = useState(manifestId);
  if (manifestId !== prevId) {
    setPrevId(manifestId);
    setDetail(null);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    void apiFetch<ManifestDetail>(`/v1/tests/${manifestId}`)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifestId]);

  return { detail, loading, error };
}
