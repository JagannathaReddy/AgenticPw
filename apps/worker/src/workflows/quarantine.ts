import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { quarantineTests, type QuarantineEdit } from '../activities/quarantine-transform.js';
import { runPlaywright } from '../activities/judge-runner.js';
import { withTenant, type Tenant } from '../db.js';
import { canAutoApply } from '../policy.js';
import { loadRepoContext } from '../repo-context.js';
import { manifestLogger } from '../logger.js';
import {
  appendEvent,
  startManifest,
  terminateManifest,
  type WorkflowTerminal,
} from '../manifest-events.js';

/**
 * QuarantineWorkflow (Sprint 5) — wrap steward-flagged flaky tests in
 * `test.fixme` via the same dry-run → apply machinery as heals.
 *
 * Deterministic: no LLM. The transform is string-level and timid; the
 * verify step proves each patched file still runs green (fixme'd tests
 * skip, neighbors still execute) by placing the patched copy NEXT TO the
 * original under a temp name — so relative imports resolve — running it,
 * and always deleting it. Originals are never touched; `agent apply`
 * commits the patch.
 */

export interface QuarantineManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      repoId?: string | null;
      stewardManifestId?: string | null;
      targets: Array<{ file: string; title: string }>;
      autoApply?: boolean | null;
    };
  };
  policy?: { refuseCategories?: string[]; trustRung?: number } | null;
  audit: { correlationId: string };
}

export interface QuarantineDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

export interface QuarantinedFile {
  originalTestPath: string;
  /** Repo-root-relative artifact copy `agent apply` copies back. */
  patchedTestPath: string;
  quarantined: string[];
  skipped: QuarantineEdit[];
  verified: boolean;
}

export async function runQuarantine(
  manifest: QuarantineManifestRow,
  deps: QuarantineDeps,
): Promise<{ status: WorkflowTerminal; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const { repoId, targets, stewardManifestId } = manifest.goal.params;
  const repo = await loadRepoContext(deps.pool, tenant, deps.config, repoId ?? null);

  await startManifest(deps.pool, tenant, manifest, {
    stage: 'started',
    workflow: 'quarantine',
    targetCount: targets.length,
    stewardManifestId: stewardManifestId ?? null,
  });
  log.info({ stage: 'started', targets: targets.length }, 'Quarantine started');

  const byFile = new Map<string, string[]>();
  for (const t of targets) {
    byFile.set(t.file, [...(byFile.get(t.file) ?? []), t.title]);
  }

  const today = new Date().toISOString().slice(0, 10);
  const shortId = manifest.id.slice(0, 8);
  const files: QuarantinedFile[] = [];

  for (const [file, titles] of byFile) {
    const absPath = path.join(repo.repoRoot, file);
    let source: string;
    try {
      source = await fs.readFile(absPath, 'utf8');
    } catch {
      files.push({
        originalTestPath: file,
        patchedTestPath: '',
        quarantined: [],
        skipped: titles.map((title) => ({ title, applied: false, reason: 'not_found' as const })),
        verified: false,
      });
      continue;
    }

    const transformed = quarantineTests(source, titles, today);
    if (transformed.appliedCount === 0) {
      files.push({
        originalTestPath: file,
        patchedTestPath: '',
        quarantined: [],
        skipped: transformed.edits,
        verified: false,
      });
      continue;
    }

    // Persist the patched copy where `agent apply` will read it from.
    const patchedRel = path.join('local-artifacts', manifest.id, 'quarantined', path.basename(file));
    await deps.artifacts.put(
      `${manifest.id}/quarantined/${path.basename(file)}`,
      transformed.content,
    );

    // Verify next to the original so relative imports resolve; always clean up.
    const checkRel = path.join(
      path.dirname(file),
      `.quarantine-check-${shortId}-${path.basename(file)}`,
    );
    const checkAbs = path.join(repo.repoRoot, checkRel);
    let verified = false;
    try {
      await fs.writeFile(checkAbs, transformed.content);
      const run = await runPlaywright(repo.repoRoot, checkRel, deps.config.testTimeoutMs, {
        project: repo.playwrightProject,
      });
      verified = run.exitCode === 0 && !run.timedOut;
    } finally {
      await fs.unlink(checkAbs).catch(() => undefined);
    }

    files.push({
      originalTestPath: file,
      patchedTestPath: patchedRel,
      quarantined: transformed.edits.filter((e) => e.applied).map((e) => e.title),
      skipped: transformed.edits.filter((e) => !e.applied),
      verified,
    });

    await withTenant(deps.pool, tenant, async (client) => {
      await appendEvent(client, manifest, 'progress', null, null, {
        stage: 'file_quarantined',
        file,
        quarantined: transformed.appliedCount,
        verified,
      });
    });
    log.info({ stage: 'file_quarantined', file, applied: transformed.appliedCount, verified }, 'File processed');
  }

  const totalQuarantined = files.reduce((n, f) => n + f.quarantined.length, 0);
  const allVerified = files.filter((f) => f.quarantined.length > 0).every((f) => f.verified);

  if (totalQuarantined === 0) {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: 'nothing_to_quarantine',
      reason:
        'No targets could be quarantined (already fixme/skip, or titles not found). ' +
        'Details in result.files.',
      files,
    });
  }
  if (!allVerified) {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: 'quarantine_verify_failed',
      reason:
        'A patched file did not run green — a neighboring test may be broken. ' +
        'Nothing was applied; see result.files.',
      files,
    });
  }

  let autoApplied = false;
  if (canAutoApply(manifest.policy as never, manifest.goal.params)) {
    for (const f of files) {
      if (!f.patchedTestPath) continue;
      await fs.copyFile(f.patchedTestPath, path.join(repo.repoRoot, f.originalTestPath));
    }
    await withTenant(deps.pool, tenant, async (client) => {
      await client.query(
        `INSERT INTO heal_feedback
           (workspace_id, repo_id, manifest_id, verdict, source, category)
         VALUES ($1, $2, $3, 'up', 'apply', 'flaky')
         ON CONFLICT (manifest_id) WHERE source = 'apply' DO NOTHING`,
        [manifest.workspace_id, repoId ?? null, manifest.id],
      );
      await appendEvent(client, manifest, 'progress', null, null, {
        stage: 'auto_applied',
        trustRung: manifest.policy?.trustRung ?? null,
        files: files.filter((f) => f.patchedTestPath).map((f) => f.originalTestPath),
      });
    });
    autoApplied = true;
    log.info({ stage: 'auto_applied' }, 'Rung 2: quarantine auto-applied');
  }

  return terminate(deps.pool, tenant, manifest, 'succeeded', {
    category: 'flaky',
    stewardManifestId: stewardManifestId ?? null,
    totalQuarantined,
    autoApplied,
    files,
  });
}

const terminate = (
  pool: pg.Pool,
  tenant: Tenant,
  manifest: QuarantineManifestRow,
  status: WorkflowTerminal,
  result: Record<string, unknown>,
) => terminateManifest(pool, tenant, manifest, status, result, 'Quarantine complete');
