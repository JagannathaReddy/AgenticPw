"use client";

import { useEffect } from "react";
import { useConsoleStore } from "@/store/useConsoleStore";

const POLL_MS = 4000;

export function useConsoleBootstrap() {
  const refreshAll = useConsoleStore((s) => s.refreshAll);
  const refreshManifests = useConsoleStore((s) => s.refreshManifests);
  const hasRunning = useConsoleStore((s) =>
    s.manifests.some((m) => m.status === "running" || m.status === "created"),
  );

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const ms = hasRunning ? POLL_MS : POLL_MS * 3;
    const id = setInterval(() => void refreshManifests(), ms);
    return () => clearInterval(id);
  }, [hasRunning, refreshManifests]);
}
