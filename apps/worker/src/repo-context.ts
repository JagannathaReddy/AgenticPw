import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { Tenant } from './db.js';
import { withTenant } from './db.js';

/**
 * Registered-repo context every workflow resolves before doing work.
 * One loader replaces the per-workflow copies; each caller uses the
 * fields it needs.
 */
export interface RepoContext {
  repoRoot: string;
  repoProfile: unknown | null;
  repoName: string | null;
  /** env override → onboarding-detected primary project → '' (Playwright default). */
  playwrightProject: string;
}

export interface RepoContextConfig {
  repoRoot: string;
  playwrightProject: string;
}

export function resolvePlaywrightProject(
  config: { playwrightProject: string },
  repoProfile: unknown | null,
): string {
  const detected = ((repoProfile as Record<string, unknown> | null)?.playwright_detected ??
    null) as { primaryProject?: string } | null;
  return config.playwrightProject || detected?.primaryProject || '';
}

export async function loadRepoContext(
  pool: pg.Pool,
  tenant: Tenant,
  config: RepoContextConfig,
  repoId: string | null | undefined,
): Promise<RepoContext> {
  const fallback: RepoContext = {
    repoRoot: config.repoRoot,
    repoProfile: null,
    repoName: null,
    playwrightProject: resolvePlaywrightProject(config, null),
  };
  if (!repoId) return fallback;
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{
      local_path: string | null;
      full_name: string;
      conventions: unknown | null;
    }>(
      `SELECT r.local_path, r.full_name, p.conventions
         FROM repositories r
         LEFT JOIN repo_profiles p ON p.id = r.profile_id
        WHERE r.id = $1`,
      [repoId],
    );
    if (rows.length === 0) return fallback;
    const row = rows[0];
    return {
      repoRoot: row.local_path ?? config.repoRoot,
      repoProfile: row.conventions ?? null,
      repoName: row.full_name,
      playwrightProject: resolvePlaywrightProject(config, row.conventions ?? null),
    };
  });
}

/** Sibling `pages/<name>.page.ts` (or same-dir) guess used by triage + improve. */
export async function guessPageObjectPath(
  repoRoot: string,
  specPath: string,
): Promise<string | null> {
  const dir = path.dirname(specPath);
  const base = path.basename(specPath).replace(/\.spec\.(tsx?)$/, '.page.$1');
  const candidates = [path.join(dir, 'pages', base), path.join(dir, base)];
  for (const rel of candidates) {
    try {
      await fs.access(path.join(repoRoot, rel));
      return rel;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

/** Read a file, or a marker string when it doesn't exist (LLM prompt inputs). */
export async function readOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '(none — file not found)';
  }
}
