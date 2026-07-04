import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { runImprover } from '../activities/improver.js';
import { runPlaywright } from '../activities/judge-runner.js';
import { withTenant } from '../db.js';
import { manifestLogger } from '../logger.js';
import { appendEvent } from '../manifest-events.js';

export interface ImproveManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      repoId?: string | null;
      testPath: string;
      pageObjectPath?: string | null;
    };
  };
  audit: { correlationId: string };
}

export interface ImproveDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

interface RepoContext {
  repoRoot: string;
  repoProfile: unknown | null;
}

async function loadRepoContext(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  fallbackRoot: string,
  repoId: string | null | undefined,
): Promise<RepoContext> {
  if (!repoId) return { repoRoot: fallbackRoot, repoProfile: null };
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{
      local_path: string | null;
      conventions: unknown | null;
    }>(
      `SELECT r.local_path, p.conventions
         FROM repositories r
         LEFT JOIN repo_profiles p ON p.id = r.profile_id
        WHERE r.id = $1`,
      [repoId],
    );
    if (rows.length === 0) return { repoRoot: fallbackRoot, repoProfile: null };
    return {
      repoRoot: rows[0].local_path ?? fallbackRoot,
      repoProfile: rows[0].conventions ?? null,
    };
  });
}

async function guessPageObjectPath(repoRoot: string, specPath: string): Promise<string | null> {
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

/**
 * ImproveWorkflow — polish an existing spec (typically from `playwright codegen`)
 * in the target repo's own conventions. Dry-run by default: writes the improved
 * files to a manifest-scoped path so `agent apply` (or a user's diff view) can
 * inspect before overwriting the original.
 */
export async function runImprove(
  manifest: ImproveManifestRow,
  deps: ImproveDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const { repoId, testPath, pageObjectPath: rawPagePath } = manifest.goal.params;
  const repo = await loadRepoContext(deps.pool, tenant, deps.config.repoRoot, repoId ?? null);

  await withTenant(deps.pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = 'in_progress', started_at = now() WHERE id = $1`,
      [manifest.id],
    );
    await appendEvent(client, manifest, 'progress', 'assigned', 'in_progress', {
      stage: 'started',
      workflow: 'improve',
      repoId: repoId ?? null,
      repoRoot: repo.repoRoot,
      testPath,
    });
  });
  log.info({ stage: 'started', testPath, repoRoot: repo.repoRoot }, 'Improve started');

  const pageObjectPath = rawPagePath ?? (await guessPageObjectPath(repo.repoRoot, testPath));

  const detected = ((repo.repoProfile as Record<string, unknown> | null)
    ?.playwright_detected ?? null) as { primaryProject?: string } | null;
  const resolvedProject =
    deps.config.playwrightProject || detected?.primaryProject || '';

  const improved = await runImprover(
    {
      manifestId: manifest.id,
      correlationId: manifest.audit.correlationId,
      testPath,
      pageObjectPath,
      repoRoot: repo.repoRoot,
      repoProfile: repo.repoProfile,
    },
    deps.artifacts,
    deps.config,
    deps.pool,
    tenant,
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'improver_done',
      kind: improved.parse.kind,
      prompt: improved.promptRef,
      usage: improved.usage,
    });
  });

  if (improved.parse.kind === 'refused') {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: improved.parse.category,
      reason: `Improver refused: ${improved.parse.reason}`,
    });
  }

  // Write to a manifest-scoped subdir so the original is untouched.
  const shortId = manifest.id.slice(0, 8);
  const improvedDir = path.join('tests', 'improved', shortId);
  const improvedSpecRel = path.join(improvedDir, path.basename(improved.parse.spec.path));
  const improvedPageRel = improved.parse.pageObject
    ? path.join(improvedDir, 'pages', path.basename(improved.parse.pageObject.path))
    : null;

  await deps.artifacts.put(
    `${manifest.id}/improved/${improvedSpecRel}`,
    improved.parse.spec.content,
  );
  if (improved.parse.pageObject && improvedPageRel) {
    await deps.artifacts.put(
      `${manifest.id}/improved/${improvedPageRel}`,
      improved.parse.pageObject.content,
    );
  }
  if (improved.parse.notes) {
    await deps.artifacts.put(
      `${manifest.id}/improver-notes.md`,
      improved.parse.notes,
    );
  }

  const specAbs = path.join(repo.repoRoot, improvedSpecRel);
  await fs.mkdir(path.dirname(specAbs), { recursive: true });
  await fs.writeFile(specAbs, improved.parse.spec.content);
  if (improved.parse.pageObject && improvedPageRel) {
    const pageAbs = path.join(repo.repoRoot, improvedPageRel);
    await fs.mkdir(path.dirname(pageAbs), { recursive: true });
    await fs.writeFile(pageAbs, improved.parse.pageObject.content);
  }

  // Verify the improved test still passes. If Playwright refuses to run
  // (e.g. no browser installed), we still report success with the caveat
  // — refusing to ship is worse than reporting an unverified diff.
  const verify = await runPlaywright(
    repo.repoRoot,
    improvedSpecRel,
    deps.config.testTimeoutMs,
    { project: resolvedProject },
  );

  await deps.artifacts.put(`${manifest.id}/verify.stdout.log`, verify.stdout);
  await deps.artifacts.put(`${manifest.id}/verify.stderr.log`, verify.stderr);

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'verify_done',
      exitCode: verify.exitCode,
      passed: verify.exitCode === 0,
      durationMs: verify.durationMs,
      improvedTestPath: improvedSpecRel,
      improvedPageObjectPath: improvedPageRel,
    });
  });

  if (verify.exitCode !== 0 || verify.timedOut) {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: 'improve_regressed',
      reason: `Improved spec no longer passes (exit ${verify.exitCode}). Tail: ${verify.output.slice(-500)}`,
      improvedTestPath: improvedSpecRel,
    });
  }

  return terminate(deps.pool, tenant, manifest, 'succeeded', {
    originalTestPath: testPath,
    // Reuse triage's field names so the CLI's dry-run diff renderer works
    // unchanged (see emitDiffIfTriageSucceeded).
    patchedTestPath: improvedSpecRel,
    patchedPageObjectPath: improvedPageRel,
    notes: improved.parse.notes || null,
  });
}

async function terminate(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  manifest: ImproveManifestRow,
  status: 'succeeded' | 'rejected' | 'failed',
  result: Record<string, unknown>,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = $2, finished_at = now(), result = $3::jsonb WHERE id = $1`,
      [manifest.id, status, JSON.stringify({ status, ...result })],
    );
    await appendEvent(client, manifest, status, 'in_progress', status, result);
  });
  const message =
    status === 'succeeded'
      ? 'Improve complete'
      : String((result as { reason?: string }).reason ?? status);
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const level = status === 'succeeded' ? 'info' : 'warn';
  log[level]({ status, category: (result as { category?: string }).category }, message);
  return { status, message };
}

