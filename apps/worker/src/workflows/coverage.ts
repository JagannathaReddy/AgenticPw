import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import { runExplorer } from '../activities/explorer.js';
import { runGenerator } from '../activities/generator.js';
import { runJudge } from '../activities/judge.js';

export interface CoverageManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      targetUrl: string;
      expectedOutcomes: string[];
      maxSteps: number;
    };
  };
  audit: { correlationId: string };
}

export interface CoverageDeps {
  artifacts: ArtifactStore;
}

/**
 * Local Coverage workflow. Runs Explorer → Generator → Judge and records
 * every transition to manifest_events. The client already has a BEGIN
 * open with tenant context set.
 */
export async function runCoverage(
  client: pg.PoolClient,
  manifest: CoverageManifestRow,
  deps: CoverageDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const goal = manifest.goal;
  const targetUrl = goal.params.targetUrl;
  const expectedOutcomes = goal.params.expectedOutcomes ?? [];
  const maxSteps = goal.params.maxSteps ?? 30;

  await appendEvent(client, manifest, 'assigned', 'pending', 'assigned', {
    workflow: 'coverage',
  });

  await client.query(
    `UPDATE manifests SET status = 'in_progress', started_at = now() WHERE id = $1`,
    [manifest.id],
  );
  await appendEvent(client, manifest, 'progress', 'assigned', 'in_progress', {
    stage: 'started',
  });

  // 1. Explorer
  const exploration = await runExplorer(
    {
      manifestId: manifest.id,
      targetUrl,
      goal: goal.description,
      expectedOutcomes,
      maxSteps,
    },
    deps.artifacts,
  );
  await appendEvent(client, manifest, 'progress', null, null, {
    stage: 'exploration_done',
    verified: exploration.verified,
    ariaSnapshotPath: exploration.ariaSnapshotPath,
    actionCount: exploration.actions.length,
  });

  if (!exploration.verified) {
    await terminate(client, manifest, 'rejected', {
      category: 'outcomes_not_verified',
      reason: exploration.reason ?? 'Explorer did not verify expected outcomes',
    });
    return { status: 'rejected', message: 'Outcomes not verified in exploration' };
  }

  // 2. Generator
  const generation = await runGenerator(
    {
      manifestId: manifest.id,
      goal: goal.description,
      targetUrl,
      expectedOutcomes,
      exploration,
    },
    deps.artifacts,
  );
  await appendEvent(client, manifest, 'progress', null, null, {
    stage: 'generation_done',
    testPath: generation.testPath,
    pageObjectPath: generation.pageObjectPath,
    prompt: generation.promptRef,
  });

  // 3. Judge
  const judgment = await runJudge({
    manifestId: manifest.id,
    testPath: generation.testPath,
    expectedOutcomes,
  });
  await appendEvent(client, manifest, 'progress', null, null, {
    stage: 'judgment_done',
    passed: judgment.passed,
    matchedOutcomes: judgment.matchedOutcomes,
  });

  if (!judgment.passed) {
    await terminate(client, manifest, 'rejected', {
      category: 'test_did_not_pass',
      reason: judgment.reason ?? 'Judge did not confirm outcomes',
    });
    return { status: 'rejected', message: 'Judge rejected' };
  }

  await terminate(client, manifest, 'succeeded', {
    testPath: generation.testPath,
    pageObjectPath: generation.pageObjectPath,
  });
  return { status: 'succeeded', message: 'Coverage complete' };
}

async function terminate(
  client: pg.PoolClient,
  manifest: CoverageManifestRow,
  status: 'succeeded' | 'rejected' | 'failed',
  result: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE manifests
       SET status = $2, finished_at = now(), result = $3::jsonb
     WHERE id = $1`,
    [manifest.id, status, JSON.stringify({ status, ...result })],
  );
  await appendEvent(client, manifest, status, 'in_progress', status, result);
}

async function appendEvent(
  client: pg.PoolClient,
  manifest: CoverageManifestRow,
  kind: string,
  fromStatus: string | null,
  toStatus: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO manifest_events
       (manifest_id, workspace_id, kind, from_status, to_status, actor, payload, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      manifest.id,
      manifest.workspace_id,
      kind,
      fromStatus,
      toStatus,
      'system:worker',
      JSON.stringify(payload),
      manifest.audit.correlationId,
    ],
  );
}
