const API_URL = (process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

/** Forward /v1/* from the Next dev server to the Fastify API. */
export async function proxyToApi(request: Request, pathSegments: string[]): Promise<Response> {
  const incoming = new URL(request.url);
  const path = pathSegments.map(encodeURIComponent).join('/');
  const target = `${API_URL}/v1/${path}${incoming.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
    headers.set(key, value);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  try {
    const res = await fetch(target, init);
    const outHeaders = new Headers();
    for (const [key, value] of res.headers) {
      if (key.toLowerCase() === 'transfer-encoding') continue;
      outHeaders.set(key, value);
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return Response.json(
      {
        error: 'api_unreachable',
        message:
          'Cannot reach the Fastify API on :3001. From the repo root run `npm run dev` (starts api + worker + web).',
        code: code ?? 'UNKNOWN',
      },
      { status: 503 },
    );
  }
}
