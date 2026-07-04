import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { runExplorer } from '../activities/explorer.js';
import { runGenerator } from '../activities/generator.js';
import { runJudge } from '../activities/judge.js';
import { withTenant } from '../db.js';
import { manifestLogger } from '../logger.js';
import { appendEvent } from '../manifest-events.js';

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
      repoId?: string | null;
    };
  };
  audit: { correlationId: string };
}

interface LoadedRepo {
  repoRoot: string;
  repoProfile: unknown | null;
  repoName: string | null;
}

async function loadRepoContext(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  fallbackRoot: string,
  repoId: string | null | undefined,
): Promise<LoadedRepo> {
  if (!repoId) return { repoRoot: fallbackRoot, repoProfile: null, repoName: null };
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
    if (rows.length === 0) {
      return { repoRoot: fallbackRoot, repoProfile: null, repoName: null };
    }
    const row = rows[0];
    return {
      repoRoot: row.local_path ?? fallbackRoot,
      repoProfile: row.conventions ?? null,
      repoName: row.full_name,
    };
  });
}

export interface CoverageDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

/**
 * Local Coverage workflow.
 *
 * Each phase (transition, exploration, generation, judgment, terminate)
 * runs in its own short transaction so intermediate progress is visible to
 * other DB readers immediately — not held hostage to a multi-minute
 * Explorer or Generator call.
 */
export async function runCoverage(
  manifest: CoverageManifestRow,
  deps: CoverageDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const goal = manifest.goal;
  const targetUrl = goal.params.targetUrl;
  const expectedOutcomes = goal.params.expectedOutcomes ?? [];
  const maxSteps = goal.params.maxSteps ?? 30;
  const repoId = goal.params.repoId ?? null;
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);

  const repoContext = await loadRepoContext(deps.pool, tenant, deps.config.repoRoot, repoId);

  // Transition to in_progress + record 'started' event.
  await withTenant(deps.pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = 'in_progress', started_at = now() WHERE id = $1`,
      [manifest.id],
    );
    await appendEvent(client, manifest, 'progress', 'assigned', 'in_progress', {
      stage: 'started',
      workflow: 'coverage',
      repoId,
      repoRoot: repoContext.repoRoot,
      hasProfile: repoContext.repoProfile !== null,
    });
  });
  log.info(
    {
      stage: 'started',
      repoId,
      repoRoot: repoContext.repoRoot,
      hasProfile: repoContext.repoProfile !== null,
    },
    'Coverage started',
  );

  // ── 1. Explorer ────────────────────────────────────────────────────────
  log.info({ stage: 'explorer', targetUrl }, 'Explorer opening URL');
  const exploration = await runExplorer(
    {
      manifestId: manifest.id,
      targetUrl,
      goal: goal.description,
      expectedOutcomes,
      maxSteps,
    },
    deps.artifacts,
    deps.config,
  );
  log.info(
    {
      stage: 'explorer',
      verified: exploration.verified,
      agentSuccess: exploration.agentSuccess,
      actions: exploration.actions.length,
    },
    'Explorer done',
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'exploration_done',
      verified: exploration.verified,
      agentSuccess: exploration.agentSuccess,
      agentMessage: exploration.agentMessage.slice(0, 500),
      ariaSnapshotPath: exploration.ariaSnapshotPath,
      actionCount: exploration.actions.length,
      verifyResult: exploration.verifyResult,
    });
  });

  if (!exploration.verified) {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: 'outcomes_not_verified',
      reason: exploration.reason ?? 'Explorer did not verify expected outcomes',
    });
  }

  // ── 2. Generator ───────────────────────────────────────────────────────
  log.info({ stage: 'generator' }, 'Generator rendering test');
  const generation = await runGenerator(
    {
      manifestId: manifest.id,
      correlationId: manifest.audit.correlationId,
      goal: goal.description,
      targetUrl,
      expectedOutcomes,
      exploration,
      repoRoot: repoContext.repoRoot,
      repoProfile: repoContext.repoProfile,
    },
    deps.artifacts,
    deps.config,
    deps.pool,
    tenant,
  );
  log.info(
    {
      stage: 'generator',
      testPath: generation.testPath,
      pageObjectPath: generation.pageObjectPath,
      cost_usd: generation.usage.costUSD,
      tokens_in: generation.usage.tokensInput,
      tokens_out: generation.usage.tokensOutput,
      latency_ms: generation.usage.latencyMs,
    },
    'Generator done',
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'generation_done',
      testPath: generation.testPath,
      pageObjectPath: generation.pageObjectPath,
      prompt: generation.promptRef,
      examples: generation.examplesUsed,
      usedProfile: generation.usedProfile,
      usage: generation.usage,
    });
  });

  // ── 3. Judge ───────────────────────────────────────────────────────────
  log.info({ stage: 'judge' }, 'Judge running Playwright');
  const judgment = await runJudge(
    {
      manifestId: manifest.id,
      testPath: generation.testPath,
      pageObjectPath: generation.pageObjectPath,
      expectedOutcomes,
    },
    deps.artifacts,
    deps.config,
  );
  log.info(
    {
      stage: 'judge',
      passed: judgment.passed,
      exitCode: judgment.exitCode,
      durationMs: judgment.durationMs,
      category: judgment.category,
    },
    'Judge done',
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'judgment_done',
      passed: judgment.passed,
      exitCode: judgment.exitCode,
      durationMs: judgment.durationMs,
      matchedOutcomes: judgment.matchedOutcomes,
      outcomeCoverageRatio: judgment.outcomeCoverageRatio,
      category: judgment.category,
      tracePath: judgment.tracePath,
    });
  });

  if (!judgment.passed) {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: judgment.category ?? 'test_did_not_pass',
      reason: judgment.reason ?? 'Judge did not confirm outcomes',
      exitCode: judgment.exitCode,
      outputTail: judgment.outputTail.slice(-500),
    });
  }

  return terminate(deps.pool, tenant, manifest, 'succeeded', {
    testPath: generation.testPath,
    pageObjectPath: generation.pageObjectPath,
  });
}

async function terminate(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  manifest: CoverageManifestRow,
  status: 'succeeded' | 'rejected' | 'failed',
  result: Record<string, unknown>,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests
         SET status = $2, finished_at = now(), result = $3::jsonb
       WHERE id = $1`,
      [manifest.id, status, JSON.stringify({ status, ...result })],
    );
    await appendEvent(client, manifest, status, 'in_progress', status, result);
  });
  const message =
    status === 'succeeded' ? 'Coverage complete' : String((result as { reason?: string }).reason ?? status);
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const level = status === 'succeeded' ? 'info' : 'warn';
  log[level]({ status, category: (result as { category?: string }).category }, message);
  return { status, message };
}


// short() + log() helpers removed — replaced by manifestLogger which
// includes manifestShortId in every event's structured field.
