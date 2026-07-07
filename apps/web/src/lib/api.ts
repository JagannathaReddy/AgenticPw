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

export async function apiFetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.text();
}
