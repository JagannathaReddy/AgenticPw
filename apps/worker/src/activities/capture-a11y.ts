import { chromium } from 'playwright';
import { cacheKeys, FsCache } from '../cache.js';

const SNAPSHOT_TTL_SEC = Number(process.env.SNAPSHOT_CACHE_TTL ?? 15 * 60);

/**
 * Read the page.goto() target URL out of a Playwright spec or POM source.
 * Handles:
 *   const LOGIN_URL = 'https://…';   await page.goto(LOGIN_URL);
 *   await this.page.goto('https://…');
 *   await page.goto("https://…");
 *
 * Returns the first absolute URL we find. Null when none is present (e.g.
 * the test uses baseURL from Playwright config).
 */
export function extractTargetUrl(...sources: Array<string | null | undefined>): string | null {
  const combined = sources.filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n');

  const directGoto = combined.match(/\bpage\.goto\(\s*['"`](https?:\/\/[^'"`]+)['"`]\s*[,)]/);
  if (directGoto) return directGoto[1];

  const constMatch = combined.match(/const\s+\w+\s*=\s*['"`](https?:\/\/[^'"`]+)['"`]/);
  if (constMatch) return constMatch[1];

  return null;
}

export interface A11ySnapshot {
  url: string;
  yaml: string;
  capturedAt: string;
  durationMs: number;
}

const MAX_A11Y_CHARS = 12_000;

function truncate(text: string, max = MAX_A11Y_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... (truncated ${text.length - max} chars)`;
}

/**
 * Launch Chromium, navigate to `url`, capture the body's ARIA snapshot in
 * "ai" mode, and return it. On any failure, returns null instead of
 * throwing — the healer can still run without a snapshot.
 *
 * When an `FsCache` is passed, a fresh snapshot for the same URL within
 * SNAPSHOT_CACHE_TTL (default 15 min) is served from disk instead of
 * relaunching Chromium.
 */
export async function captureA11ySnapshot(
  url: string,
  timeoutMs: number,
  headed = false,
  cache?: FsCache,
): Promise<A11ySnapshot | null> {
  const cacheKey = cacheKeys.ariaSnapshot(url);

  if (cache && !cache.isDisabled()) {
    const cached = await cache.get<A11ySnapshot>('snapshots', cacheKey);
    if (cached) return cached;
  }

  const started = Date.now();
  let browser: import('playwright').Browser | null = null;
  try {
    browser = await chromium.launch({ headless: !headed });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const raw = await page.locator('body').ariaSnapshot({ mode: 'ai' });
    const snap: A11ySnapshot = {
      url,
      yaml: truncate(raw),
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
    if (cache) {
      await cache.put('snapshots', cacheKey, snap, { ttlSeconds: SNAPSHOT_TTL_SEC });
    }
    return snap;
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
