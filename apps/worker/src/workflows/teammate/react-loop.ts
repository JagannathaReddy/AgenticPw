import type pg from 'pg';
import type { ArtifactStore } from '../../artifacts.js';
import type { WorkerConfig } from '../../config.js';
import type { TeammatePhaseRecord } from '@poc/types';
import { runAuthBootstrap } from '../../activities/auth-bootstrap.js';
import { loadRepoContext } from '../../repo-context.js';
import { withTenant, type Tenant } from '../../db.js';
import { appendEvent } from '../../manifest-events.js';
import {
  runHealRetryLoop,
  type TeammateLoopResult,
  type TeammateParentManifest,
} from './heal-retry-loop.js';

export interface ReactLoopInput {
  parentManifest: TeammateParentManifest;
  deps: {
    pool: pg.Pool;
    artifacts: ArtifactStore;
    config: WorkerConfig;
  };
}

export type ReactLoopResult = TeammateLoopResult;

async function tryAuthBootstrapPhase(
  input: ReactLoopInput,
  phases: TeammatePhaseRecord[],
): Promise<boolean> {
  const { parentManifest, deps } = input;
  const tenant = { orgId: parentManifest.org_id, workspaceId: parentManifest.workspace_id };
  const repoId = parentManifest.goal.params.repoId ?? null;
  const repo = await loadRepoContext(deps.pool, tenant, deps.config, repoId);

  const result = await runAuthBootstrap({
    repoRoot: repo.repoRoot,
    timeoutMs: deps.config.testTimeoutMs * 2,
  });

  phases.push({
    name: 'auth_bootstrap',
    manifestId: parentManifest.id,
    outcome: result.ok ? 'succeeded' : 'rejected',
    costUSD: 0,
  });

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, parentManifest, 'progress', null, null, {
      stage: 'auth_bootstrap',
      ok: result.ok,
      setupProjectsRun: result.setupProjectsRun,
      storageStatesFound: result.storageStatesFound,
      errors: result.errors,
    });
  });

  return result.ok;
}

export async function runReactLoop(input: ReactLoopInput): Promise<ReactLoopResult> {
  const phases: TeammatePhaseRecord[] = [];
  await tryAuthBootstrapPhase(input, phases);
  return runHealRetryLoop({
    parentManifest: input.parentManifest,
    deps: input.deps,
    phases,
    eventStage: 'react_loop_attempt',
  });
}
