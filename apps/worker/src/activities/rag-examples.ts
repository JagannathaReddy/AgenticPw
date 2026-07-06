import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { Tenant } from '../db.js';
import { withTenant } from '../db.js';
import { embed, type EmbedMeta } from '../llm.js';

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

export async function walkSpecs(dir: string): Promise<string[]> {
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

export interface SemanticContext {
  pool: pg.Pool;
  tenant: Tenant;
  repoId: string;
  meta: EmbedMeta;
}

export interface PickOptions {
  repoRoot: string;
  testsDir?: string;      // default "tests"
  goalText: string;
  k?: number;
  /** When present, try pgvector cosine similarity before the keyword ranker. */
  semantic?: SemanticContext;
}

export type PickMethod = 'semantic' | 'keyword';

export interface PickResult {
  examples: FewShotExample[];
  method: PickMethod;
}

/**
 * Semantic path: embed the goal, cosine top-k against the repo's spec
 * embeddings (built at onboarding). Returns null when embeddings are
 * absent/unavailable — the caller falls back to the keyword ranker, which
 * is exactly the swap this file promised in v0.
 */
async function semanticPick(opts: PickOptions): Promise<FewShotExample[] | null> {
  const ctx = opts.semantic;
  if (!ctx) return null;
  const k = opts.k ?? 3;
  const [goalVector] = await embed([opts.goalText], ctx.meta, ctx.pool, ctx.tenant);
  const rows = await withTenant(ctx.pool, ctx.tenant, async (client) => {
    const { rows } = await client.query<{ file_path: string; similarity: number }>(
      `SELECT file_path, 1 - (embedding <=> $1::vector) AS similarity
         FROM test_file_embeddings
        WHERE repo_id = $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [`[${goalVector.join(',')}]`, ctx.repoId, k],
    );
    return rows;
  });
  if (rows.length === 0) return null;

  const picked: FewShotExample[] = [];
  for (const row of rows) {
    const abs = path.join(opts.repoRoot, row.file_path);
    const content = await readOptional(abs);
    if (!content) continue; // embedded file since deleted — skip
    let pageObjectPath: string | undefined;
    let pageObjectContent: string | undefined;
    for (const candidate of guessPageObjectPath(abs)) {
      const c = await readOptional(candidate);
      if (c) {
        pageObjectPath = path.relative(opts.repoRoot, candidate);
        pageObjectContent = c;
        break;
      }
    }
    picked.push({
      testPath: row.file_path,
      testContent: content,
      pageObjectPath,
      pageObjectContent,
      score: Number(row.similarity),
      matchedTerms: ['semantic'],
    });
  }
  return picked.length > 0 ? picked : null;
}

/**
 * Pick up to k similar spec files: pgvector cosine similarity when the repo
 * has embeddings (Sprint 8), keyword overlap otherwise. Never throws for
 * retrieval reasons — semantic failures degrade to keyword.
 */
export async function pickFewShotExamples(opts: PickOptions): Promise<PickResult> {
  if (opts.semantic) {
    try {
      const semantic = await semanticPick(opts);
      if (semantic) return { examples: semantic, method: 'semantic' };
    } catch {
      /* embeddings unavailable / over budget → keyword fallback */
    }
  }

  const testsDir = path.join(opts.repoRoot, opts.testsDir ?? 'tests');
  const k = opts.k ?? 3;

  const specFiles = await walkSpecs(testsDir);
  if (specFiles.length === 0) return { examples: [], method: 'keyword' };

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
  return { examples: picked, method: 'keyword' };
}
