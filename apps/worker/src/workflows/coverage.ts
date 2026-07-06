import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { runExplorer } from '../activities/explorer.js';
import { runGenerator } from '../activities/generator.js';
import { runJudge } from '../activities/judge.js';
import { withTenant, type Tenant } from '../db.js';
import { loadRepoContext } from '../repo-context.js';
import { manifestLogger } from '../logger.js';
import {
  appendEvent,
  startManifest,
  terminateManifest,
  type WorkflowTerminal,
} from '../manifest-events.js';

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

  const repoContext = await loadRepoContext(deps.pool, tenant, deps.config, repoId);

  // Transition to in_progress + record 'started' event.
  await startManifest(deps.pool, tenant, manifest, {
      stage: 'started',
      workflow: 'coverage',
      repoId,
      repoRoot: repoContext.repoRoot,
      hasProfile: repoContext.repoProfile !== null,
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
      repoId,
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

const terminate = (
  pool: pg.Pool,
  tenant: Tenant,
  manifest: CoverageManifestRow,
  status: WorkflowTerminal,
  result: Record<string, unknown>,
) => terminateManifest(pool, tenant, manifest, status, result, 'Coverage complete');


// short() + log() helpers removed — replaced by manifestLogger which
// includes manifestShortId in every event's structured field.
