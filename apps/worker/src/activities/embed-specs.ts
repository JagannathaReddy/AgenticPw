import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { Tenant } from '../db.js';
import { withTenant } from '../db.js';
import { embed, type EmbedMeta } from '../llm.js';
import { walkSpecs } from './rag-examples.js';

/**
 * Embed a repo's spec files into test_file_embeddings (Sprint 8).
 * Runs at onboarding; sha-skips unchanged files so re-onboarding is cheap.
 * Failures are the caller's to swallow — semantic RAG always has the
 * keyword fallback, so embeddings must never fail an onboarding.
 */

const MAX_FILES = 50;
const EMBED_CHARS = 4000; // ~1k tokens per file — plenty for style similarity
const SUMMARY_CHARS = 300;

export interface EmbedSpecsResult {
  files: number;
  embedded: number;
  unchanged: number;
}

export async function embedRepoSpecs(
  repoRoot: string,
  repoId: string,
  meta: EmbedMeta,
  pool: pg.Pool,
  tenant: Tenant,
  testDir = 'tests',
): Promise<EmbedSpecsResult> {
  const testsDir = path.join(repoRoot, testDir);
  const specs = (await walkSpecs(testsDir)).slice(0, MAX_FILES);

  const existing = await withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{ file_path: string; file_sha: string }>(
      `SELECT file_path, file_sha FROM test_file_embeddings WHERE repo_id = $1`,
      [repoId],
    );
    return new Map(rows.map((r) => [r.file_path, r.file_sha]));
  });

  const toEmbed: Array<{ relPath: string; sha: string; text: string }> = [];
  for (const abs of specs) {
    const relPath = path.relative(repoRoot, abs);
    const content = await fs.readFile(abs, 'utf8').catch(() => null);
    if (!content) continue;
    const sha = createHash('sha256').update(content).digest('hex');
    if (existing.get(relPath) === sha) continue;
    toEmbed.push({ relPath, sha, text: content.slice(0, EMBED_CHARS) });
  }

  if (toEmbed.length === 0) {
    return { files: specs.length, embedded: 0, unchanged: specs.length };
  }

  const vectors = await embed(
    toEmbed.map((f) => f.text),
    meta,
    pool,
    tenant,
  );

  await withTenant(pool, tenant, async (client) => {
    for (let i = 0; i < toEmbed.length; i++) {
      const f = toEmbed[i];
      await client.query(
        `INSERT INTO test_file_embeddings
           (workspace_id, repo_id, file_path, file_sha, summary, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)
         ON CONFLICT (repo_id, file_path)
         DO UPDATE SET file_sha = EXCLUDED.file_sha,
                       summary = EXCLUDED.summary,
                       embedding = EXCLUDED.embedding,
                       updated_at = now()`,
        [
          tenant.workspaceId,
          repoId,
          f.relPath,
          f.sha,
          f.text.slice(0, SUMMARY_CHARS),
          `[${vectors[i].join(',')}]`,
        ],
      );
    }
  });

  return {
    files: specs.length,
    embedded: toEmbed.length,
    unchanged: specs.length - toEmbed.length,
  };
}
