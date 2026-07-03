import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Stack-source walker (#10).
 *
 * Enterprise suites layer helper classes between the spec and Playwright:
 *
 *   FrameworkError: Timed out probing map points for "Create new streetlight"
 *       at DashboardPage.openCreateStreetlightForm (src/pages/iac/DashboardPage.ts:145)
 *       at CreateStreetlightPage.open (src/pages/iac/CreateStreetlightPage.ts:12)
 *
 * The healer used to see only the spec + one page object; every file in the
 * stack above was invisible. This module extracts source paths from failure
 * output so the Triage workflow can load them as extra healer context — and
 * refuse with `out_of_scope` when the failing code can't be loaded at all.
 */

const SOURCE_EXT_RE = /\.(?:tsx?|jsx?|mjs|cjs)$/;

/**
 * Matches the path segment of a stack frame, either form:
 *   at Foo.bar (src/pages/DashboardPage.ts:145:10)
 *   at src/helpers/retry.ts:12:5
 * plus Windows separators and absolute paths.
 */
const FRAME_RE =
  /(?:\(|\s|^)((?:[A-Za-z]:)?[\w@./\\-]+?\.(?:tsx?|jsx?|mjs|cjs)):\d+(?::\d+)?\)?/gm;

function isNoise(p: string): boolean {
  return (
    p.includes('node_modules') ||
    p.startsWith('node:') ||
    p.includes('playwright-core') ||
    p.includes('@playwright/')
  );
}

/** Normalize separators so Windows frames compare equal to posix paths. */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Extract unique source paths from failure output, in order of first
 * appearance (deepest frame first — Playwright prints innermost at the top,
 * which is where the failing line actually lives).
 */
export function extractStackPaths(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(FRAME_RE.source, 'gm');
  while ((m = re.exec(text)) !== null) {
    const raw = toPosix(m[1].trim());
    if (!SOURCE_EXT_RE.test(raw)) continue;
    if (isNoise(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

export interface RelatedSource {
  path: string;    // repo-relative, posix separators
  content: string;
}

export interface LoadRelatedResult {
  loaded: RelatedSource[];
  /** Stack paths that pointed at real frames we could NOT read. */
  missing: string[];
}

const MAX_FILE_BYTES = 24 * 1024;

/**
 * Resolve stack paths against the repo root and read the top `max` files.
 *
 * - Absolute paths are accepted only when inside repoRoot (then relativized).
 * - Paths already loaded elsewhere (spec, page object) are skipped via
 *   `exclude`.
 * - Oversized files are truncated head-first — the class/method named in the
 *   stack is usually near the top; the tail is boilerplate.
 */
export async function loadRelatedSources(
  repoRoot: string,
  stackPaths: string[],
  opts: { exclude?: Array<string | null>; max?: number } = {},
): Promise<LoadRelatedResult> {
  const max = opts.max ?? 3;
  const excluded = new Set(
    (opts.exclude ?? [])
      .filter((p): p is string => !!p)
      .map((p) => toPosix(path.normalize(p))),
  );
  const rootAbs = path.resolve(repoRoot);

  const loaded: RelatedSource[] = [];
  const missing: string[] = [];

  for (const candidate of stackPaths) {
    if (loaded.length >= max) break;

    let rel: string;
    if (path.isAbsolute(candidate) || /^[A-Za-z]:\//.test(candidate)) {
      const abs = path.resolve(candidate);
      if (!abs.startsWith(rootAbs + path.sep)) continue; // outside the repo — not ours to read
      rel = toPosix(path.relative(rootAbs, abs));
    } else {
      rel = toPosix(path.normalize(candidate));
    }

    if (rel.startsWith('..')) continue;
    if (excluded.has(rel)) continue;

    try {
      let content = await fs.readFile(path.join(rootAbs, rel), 'utf8');
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
        content = content.slice(0, MAX_FILE_BYTES) + '\n// … (truncated for prompt)';
      }
      loaded.push({ path: rel, content });
    } catch {
      missing.push(rel);
    }
  }

  return { loaded, missing };
}

/**
 * Expand user-supplied `--include` globs (relative to repoRoot) into
 * repo-relative source paths. Uses Node's built-in fs glob (Node 22+).
 * Non-source files and node_modules are filtered out.
 */
export async function expandIncludeGlobs(
  repoRoot: string,
  globs: string[],
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pattern of globs) {
    // A leading slash or drive letter would escape the repo — refuse the pattern.
    if (path.isAbsolute(pattern) || /^[A-Za-z]:/.test(pattern) || pattern.includes('..')) {
      continue;
    }
    for await (const match of fs.glob(pattern, { cwd: repoRoot })) {
      const rel = toPosix(String(match));
      if (!SOURCE_EXT_RE.test(rel)) continue;
      if (isNoise(rel)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

/** Render related sources as a prompt section. */
export function renderRelatedSources(loaded: RelatedSource[]): string {
  if (loaded.length === 0) return '(none — stack trace stayed within the spec and page object)';
  return loaded
    .map((s) => ['### `' + s.path + '`', '', '```typescript', s.content, '```'].join('\n'))
    .join('\n\n');
}
