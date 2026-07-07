/** Browser calls same-origin /v1/*; Next rewrites to the Fastify API. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Map teammate API failures to actionable fix hints. */
export function teammateApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) {
      return 'Teammate routes missing on :3001 — restart npm run dev (stale API process).';
    }
    if (err.status === 503) {
      return 'Cannot reach API on :3001 — run npm run dev from the repo root.';
    }
    const body = err.body as { message?: string; code?: string } | null;
    if (err.status === 500 && body?.message?.includes('qa_assignments')) {
      return 'Teammate schema missing — run npm run db:migrate';
    }
    return err.message;
  }
  return (err as Error).message;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body != null && init.body !== '';
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let body: unknown = null;
    let text = '';
    try {
      text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const msg =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: string }).message)
        : text || res.statusText;
    throw new ApiError(res.status, msg, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function ensureTeammateCapabilities(): Promise<string | null> {
  try {
    const health = await apiFetch<{ capabilities?: { teammate?: boolean } }>('/v1/health');
    if (health.capabilities?.teammate === false) {
      return 'Teammate schema missing — run npm run db:migrate';
    }
    if (health.capabilities?.teammate !== true) {
      return 'Teammate routes missing on :3001 — restart npm run dev (stale API process).';
    }
    return null;
  } catch (err) {
    return teammateApiError(err);
  }
}

export async function apiFetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.text();
}
