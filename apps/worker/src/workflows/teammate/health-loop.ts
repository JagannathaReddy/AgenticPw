import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ArtifactStore } from '../../artifacts.js';
import type { WorkerConfig } from '../../config.js';
import type { TeammatePhaseRecord } from '@poc/types';
import { manifestLogger } from '../../logger.js';
import { appendEvent } from '../../manifest-events.js';
import { withTenant } from '../../db.js';
import { runSteward, type StewardManifestRow } from '../steward.js';
import { sumManifestSpendUSD } from './budget.js';
import type { TeammateLoopResult } from './heal-retry-loop.js';

export interface HealthLoopInput {
  parentManifest: {
    id: string;
    org_id: string;
    workspace_id: string;
    goal: {
      params: {
        repoId?: string | null;
        stewardRuns?: number | null;
      };
    };
    audit: { correlationId: string };
  };
  deps: {
    pool: pg.Pool;
    artifacts: ArtifactStore;
    config: WorkerConfig;
  };
}

const DEFAULT_STEWARD_RUNS = 3;

async function insertStewardChild(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  parent: HealthLoopInput['parentManifest'],
  runs: number,
): Promise<StewardManifestRow> {
  const childId = randomUUID();
  const childCorrelation = randomUUID();
  const goal = {
    kind: 'suite_health',
    description: `Health check steward (${runs} runs)`,
    params: { repoId: parent.goal.params.repoId ?? null, runs },
  };

  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `INSERT INTO manifests (
         id, org_id, workspace_id, parent_manifest_id, role, status, workflow_id,
         goal, context, budget, success_gate, policy, audit
       )
       SELECT $1, org_id, workspace_id, $2, 'steward', 'assigned', $3,
              $4, context, budget, success_gate, policy, $5
         FROM manifests WHERE id = $2`,
      [
        childId,
        parent.id,
        `local-${childId}`,
        JSON.stringify(goal),
        JSON.stringify({ correlationId: childCorrelation }),
      ],
    );
  });

  return {
    id: childId,
    org_id: parent.org_id,
    workspace_id: parent.workspace_id,
    goal: goal as StewardManifestRow['goal'],
    audit: { correlationId: childCorrelation },
  };
}

export async function runHealthLoop(input: HealthLoopInput): Promise<TeammateLoopResult> {
  const { parentManifest, deps } = input;
  const log = manifestLogger(parentManifest.id, parentManifest.audit.correlationId);
  const tenant = { orgId: parentManifest.org_id, workspaceId: parentManifest.workspace_id };
  const runs = parentManifest.goal.params.stewardRuns ?? DEFAULT_STEWARD_RUNS;
  const phases: TeammatePhaseRecord[] = [];
  const childManifestIds: string[] = [];

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, parentManifest, 'progress', null, null, {
      stage: 'health_loop_start',
      runs,
    });
  });

  const stewardRow = await insertStewardChild(deps.pool, tenant, parentManifest, runs);
  childManifestIds.push(stewardRow.id);

  let outcome: { status: 'succeeded' | 'rejected' | 'failed'; message: string };
  try {
    outcome = await runSteward(stewardRow, deps);
  } catch (err) {
    outcome = { status: 'failed', message: (err as Error).message };
  }

  const stewardResult = await withTenant(deps.pool, tenant, async (client) => {
    const { rows } = await client.query<{ result: Record<string, unknown> | null }>(
      `SELECT result FROM manifests WHERE id = $1`,
      [stewardRow.id],
    );
    return rows[0]?.result ?? null;
  });

  const costUSD = await sumManifestSpendUSD(deps.pool, tenant, [stewardRow.id]);
  phases.push({
    name: 'steward',
    manifestId: stewardRow.id,
    outcome: outcome.status,
    costUSD: Number(costUSD.toFixed(4)),
  });

  log.info({ stage: 'health_loop_steward', status: outcome.status }, 'Health check steward finished');

  if (outcome.status !== 'succeeded') {
    const reason = (stewardResult?.reason as string | undefined) ?? outcome.message;
    return {
      reportStatus: 'escalated',
      phases,
      childManifestIds,
      escalations: [{ category: (stewardResult?.category as string) ?? 'steward_failed', reason }],
      summary: `Health check failed: ${reason}`,
      terminalStatus: outcome.status === 'failed' ? 'failed' : 'rejected',
      result: { stewardManifestId: stewardRow.id, category: stewardResult?.category, reason },
    };
  }

  const healthy = (stewardResult?.healthy as number | undefined) ?? 0;
  const flaky = (stewardResult?.flaky as number | undefined) ?? 0;
  const alwaysFailing = (stewardResult?.alwaysFailing as number | undefined) ?? 0;

  return {
    reportStatus: 'done',
    phases,
    childManifestIds,
    escalations: [],
    summary: `Health check: ${healthy} healthy, ${flaky} flaky, ${alwaysFailing} always failing`,
    terminalStatus: 'succeeded',
    result: {
      stewardManifestId: stewardRow.id,
      healthy,
      flaky,
      alwaysFailing,
      healCandidates: ((stewardResult?.healCandidates as string[] | undefined) ?? []).length,
    },
  };
}
