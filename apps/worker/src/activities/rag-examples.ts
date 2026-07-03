import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * v0 local RAG: scan a repo's tests/ folder for spec files, rank by a
 * lightweight goal-similarity score, and return the top k as few-shot
 * examples for the Generator.
 *
 * When we ship pgvector-backed semantic recall in a later day, this file's
 * contract stays; the ranker gets swapped.
 */

export interface FewShotExample {
  /** Path relative to repo root, e.g. "tests/seed.spec.ts". */
  testPath: string;
  testContent: string;
  /** Matching page object if one exists. */
  pageObjectPath?: string;
  pageObjectContent?: string;
  /** Debug: why this file scored where it did. */
  score: number;
  matchedTerms: string[];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be',
  'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'that', 'this', 'as', 'it',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

async function walkSpecs(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(current: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        await recurse(full);
      } else if (/\.spec\.[tj]sx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  await recurse(dir);
  return out;
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function guessPageObjectPath(testPath: string): string[] {
  const dir = path.dirname(testPath);
  const base = path.basename(testPath).replace(/\.spec\.(tsx?|jsx?)$/, '.page.$1');
  return [
    path.join(dir, 'pages', base),
    path.join(dir, base),
  ];
}

function score(query: string[], content: string): { score: number; matched: string[] } {
  const contentLower = content.toLowerCase();
  const matched: string[] = [];
  for (const term of query) {
    if (contentLower.includes(term)) matched.push(term);
  }
  return {
    score: query.length === 0 ? 0 : matched.length / query.length,
    matched,
  };
}

export interface PickOptions {
  repoRoot: string;
  testsDir?: string;      // default "tests"
  goalText: string;
  k?: number;
}

/**
 * Pick up to k similar spec files from the repo's tests dir. Returns them
 * sorted by descending relevance to the goal.
 */
export async function pickFewShotExamples(opts: PickOptions): Promise<FewShotExample[]> {
  const testsDir = path.join(opts.repoRoot, opts.testsDir ?? 'tests');
  const k = opts.k ?? 3;

  const specFiles = await walkSpecs(testsDir);
  if (specFiles.length === 0) return [];

  const query = tokens(opts.goalText);

  const scored: Array<{ file: string; content: string; score: number; matched: string[] }> = [];
  for (const file of specFiles) {
    const content = await readOptional(file);
    if (!content) continue;
    const s = score(query, content);
    scored.push({ file, content, score: s.score, matched: s.matched });
  }

  // Sort by score desc, then by shorter-file-first (usually cleaner examples).
  scored.sort((a, b) => b.score - a.score || a.content.length - b.content.length);

  const picked: FewShotExample[] = [];
  for (const item of scored.slice(0, k)) {
    let pageObjectPath: string | undefined;
    let pageObjectContent: string | undefined;
    for (const candidate of guessPageObjectPath(item.file)) {
      const c = await readOptional(candidate);
      if (c) {
        pageObjectPath = path.relative(opts.repoRoot, candidate);
        pageObjectContent = c;
        break;
      }
    }

    picked.push({
      testPath: path.relative(opts.repoRoot, item.file),
      testContent: item.content,
      pageObjectPath,
      pageObjectContent,
      score: item.score,
      matchedTerms: item.matched,
    });
  }
  return picked;
}
