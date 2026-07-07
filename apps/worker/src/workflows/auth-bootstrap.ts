import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { runAuthBootstrap } from '../activities/auth-bootstrap.js';
import { loadRepoContext } from '../repo-context.js';
import { withTenant, type Tenant } from '../db.js';
import { manifestLogger } from '../logger.js';
import {
  appendEvent,
  startManifest,
  terminateManifest,
  type WorkflowTerminal,
} from '../manifest-events.js';

export interface AuthBootstrapManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      repoId: string;
      localPath?: string | null;
    };
  };
  audit: { correlationId: string };
}

export interface AuthBootstrapDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

async function terminate(
  pool: pg.Pool,
  tenant: Tenant,
  manifest: AuthBootstrapManifestRow,
  status: WorkflowTerminal,
  result: Record<string, unknown>,
): Promise<{ status: WorkflowTerminal; message: string }> {
  const message =
    (result.reason as string | undefined) ??
    (status === 'succeeded' ? 'Auth bootstrap complete' : status);
  await terminateManifest(pool, tenant, manifest, status, result, message);
  return { status, message };
}

export async function runAuthBootstrapWorkflow(
  manifest: AuthBootstrapManifestRow,
  deps: AuthBootstrapDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const { repoId } = manifest.goal.params;

  const repo = await loadRepoContext(deps.pool, tenant, deps.config, repoId);
  const repoRoot = manifest.goal.params.localPath ?? repo.repoRoot;

  await startManifest(deps.pool, tenant, manifest, {
    stage: 'started',
    workflow: 'auth_bootstrap',
    repoId,
    repoRoot,
  });
  log.info({ stage: 'started', repoId, repoRoot }, 'Auth bootstrap started');

  let result;
  try {
    result = await runAuthBootstrap({
      repoRoot,
      timeoutMs: deps.config.testTimeoutMs * 2,
    });
  } catch (err) {
    const message = (err as Error).message;
    log.warn({ stage: 'auth_bootstrap', err: message }, 'Auth bootstrap failed');
    return terminate(deps.pool, tenant, manifest, 'failed', { reason: message });
  }

  await deps.artifacts.put(
    `${manifest.id}/auth-bootstrap.json`,
    JSON.stringify(result, null, 2),
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'auth_bootstrap_done',
      ok: result.ok,
      setupProjectsRun: result.setupProjectsRun,
      storageStatesFound: result.storageStatesFound,
      errors: result.errors,
    });
  });

  if (result.ok) {
    return terminate(deps.pool, tenant, manifest, 'succeeded', {
      setupProjectsRun: result.setupProjectsRun,
      storageStatesFound: result.storageStatesFound,
      durationMs: result.durationMs,
    });
  }

  return terminate(deps.pool, tenant, manifest, 'rejected', {
    reason: result.errors.join('; ') || 'Auth bootstrap did not produce storage states',
    setupProjectsRun: result.setupProjectsRun,
    setupProjectResults: result.setupProjectResults,
    storageStatesFound: result.storageStatesFound,
    errors: result.errors,
  });
}
