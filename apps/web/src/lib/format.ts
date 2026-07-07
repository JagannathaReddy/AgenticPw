export function shortId(id: string): string {
  return id.split('-')[0];
}

export function relTime(ts: number, now: number = Date.now()): string {
  const d = now - ts;
  if (d < 60000) return Math.max(1, Math.round(d / 1000)) + 's ago';
  if (d < 3600000) return Math.round(d / 60000) + 'm ago';
  if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
  return Math.round(d / 86400000) + 'd ago';
}

export function money(n: number | null | undefined): string {
  if (n == null) return '—';
  return '$' + n.toFixed(n < 1 ? 4 : 2);
}
