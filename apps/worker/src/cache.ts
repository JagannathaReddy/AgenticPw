import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Content-addressable cache used for ARIA snapshots and LLM responses.
 *
 * Every entry lives at:
 *   {ARTIFACTS_DIR}/cache/{namespace}/{sha256-first-16}.json
 *
 * Values are JSON-encoded to keep parsing trivial and to store metadata
 * (createdAt, ttlSeconds) alongside the payload. When a caller reads and
 * the entry is past its TTL, it's ignored and (eventually) reaped.
 *
 * Not distributed. Not concurrent-safe across processes — a race means
 * one write wins and the losers get overwritten, which is fine for us.
 * Disabled entirely when NO_CACHE=1 (per-call opt-out flag).
 */

export interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: string;
  ttlSeconds: number;
  namespace: string;
}

export interface CacheOptions {
  rootDir: string;
  disabled?: boolean;
}

export interface PutOptions {
  ttlSeconds: number;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32);
}

function entryPath(rootDir: string, namespace: string, key: string): string {
  return path.join(rootDir, 'cache', namespace, `${hashKey(key)}.json`);
}

export class FsCache {
  constructor(private readonly opts: CacheOptions) {}

  isDisabled(): boolean {
    return this.opts.disabled === true || process.env.NO_CACHE === '1';
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    if (this.isDisabled()) return null;
    const file = entryPath(this.opts.rootDir, namespace, key);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const entry = JSON.parse(raw) as CacheEntry<T>;
      const age = Date.now() - new Date(entry.createdAt).getTime();
      if (age > entry.ttlSeconds * 1000) return null;
      return entry.value;
    } catch {
      return null;
    }
  }

  async put<T>(
    namespace: string,
    key: string,
    value: T,
    options: PutOptions,
  ): Promise<void> {
    if (this.isDisabled()) return;
    const file = entryPath(this.opts.rootDir, namespace, key);
    const entry: CacheEntry<T> = {
      key,
      value,
      createdAt: new Date().toISOString(),
      ttlSeconds: options.ttlSeconds,
      namespace,
    };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(entry));
  }

  async invalidate(namespace: string, key: string): Promise<void> {
    const file = entryPath(this.opts.rootDir, namespace, key);
    await fs.rm(file, { force: true });
  }
}

/**
 * Key-builder helpers so callers don't hash inline. Whatever we hash here
 * becomes part of the cache key, so it must fully determine the response.
 */
export const cacheKeys = {
  /**
   * Snapshot cache key: hash(url + userAgent + optional storageStateHash).
   * If any of those change, the snapshot is materially different, so we
   * miss on purpose.
   */
  ariaSnapshot(url: string, userAgent = '', storageStateHash = ''): string {
    return `${url}|${userAgent}|${storageStateHash}`;
  },

  /**
   * LLM response cache key: prompt id + hash + rendered-content hash + model
   * + temperature. Bump one, get a new cell.
   */
  llmResponse(input: {
    promptId: string;
    promptHash: string;
    renderedContent: string;
    model: string;
    temperature: number;
  }): string {
    const rendered = createHash('sha256')
      .update(input.renderedContent, 'utf8')
      .digest('hex')
      .slice(0, 16);
    return [
      input.promptId,
      input.promptHash,
      rendered,
      input.model,
      input.temperature.toFixed(2),
    ].join('|');
  },
};
