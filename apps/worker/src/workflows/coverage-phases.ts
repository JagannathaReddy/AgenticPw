import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { runExplorer } from '../activities/explorer.js';
import { runGenerator } from '../activities/generator.js';
import { runJudge } from '../activities/judge.js';
import { withTenant } from '../db.js';
import { loadRepoContext } from '../repo-context.js';
import { manifestLogger } from '../logger.js';
import { appendEvent } from '../manifest-events.js';
import type { TeammatePhaseRecord } from '@poc/types';
import { sumManifestSpendUSD } from './teammate/budget.js';

export interface CoveragePhasesManifest {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    description: string;
    params: {
      targetUrl: string;
      expectedOutcomes: string[];
      maxSteps?: number;
      repoId?: string | null;
    };
  };
  audit: { correlationId: string };
}

export interface CoveragePhasesDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

export type CoveragePhasesOutcome =
  | {
      status: 'passed';
      testPath: string;
      pageObjectPath: string;
    }
  | {
      status: 'explore_failed';
      category: string;
      reason: string;
    }
  | {
      status: 'judge_failed';
      category: string;
      reason: string;
      testPath: string;
      pageObjectPath: string;
    }
  | {
      status: 'failed';
      category: string;
      reason: string;
    };

const JUDGE_HEALABLE = new Set(['test_failed', 'test_timed_out', 'outcome_not_asserted']);

export function isJudgeFailureHealable(category: string | undefined): boolean {
  return category !== undefined && JUDGE_HEALABLE.has(category);
}

export async function runCoveragePhases(
  manifest: CoveragePhasesManifest,
  deps: CoveragePhasesDeps,
  phases: TeammatePhaseRecord[],
): Promise<CoveragePhasesOutcome> {
  const goal = manifest.goal;
  const targetUrl = goal.params.targetUrl;
  const expectedOutcomes = goal.params.expectedOutcomes ?? [];
  const maxSteps = goal.params.maxSteps ?? 30;
  const repoId = goal.params.repoId ?? null;
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);

  const repoContext = await loadRepoContext(deps.pool, tenant, deps.config, repoId);

  log.info({ stage: 'explorer', targetUrl }, 'StoryLoop explorer opening URL');
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

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'exploration_done',
      verified: exploration.verified,
      actionCount: exploration.actions.length,
    });
  });

  const exploreCost = await sumManifestSpendUSD(deps.pool, tenant, [manifest.id]);
  phases.push({
    name: 'explore',
    outcome: exploration.verified ? 'passed' : 'failed',
    costUSD: Number(exploreCost.toFixed(4)),
  });

  if (!exploration.verified) {
    return {
      status: 'explore_failed',
      category: 'outcomes_not_verified',
      reason: exploration.reason ?? 'Explorer did not verify expected outcomes',
    };
  }

  log.info({ stage: 'generator' }, 'StoryLoop generator rendering test');
  let generation;
  try {
    generation = await runGenerator(
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
  } catch (err) {
    return {
      status: 'failed',
      category: 'generation_failed',
      reason: (err as Error).message,
    };
  }

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'generation_done',
      testPath: generation.testPath,
      pageObjectPath: generation.pageObjectPath,
    });
  });

  const genCost = await sumManifestSpendUSD(deps.pool, tenant, [manifest.id]);
  phases.push({
    name: 'generate',
    outcome: 'passed',
    costUSD: Number((genCost - exploreCost).toFixed(4)),
  });

  log.info({ stage: 'judge' }, 'StoryLoop judge running Playwright');
  const judgment = await runJudge(
    {
      manifestId: manifest.id,
      testPath: generation.testPath,
      pageObjectPath: generation.pageObjectPath,
      expectedOutcomes,
    },
    deps.artifacts,
    deps.config,
    {
      repoRoot: repoContext.repoRoot,
      playwrightProject: repoContext.playwrightProject,
    },
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'judgment_done',
      passed: judgment.passed,
      category: judgment.category,
    });
  });

  const judgeCost = await sumManifestSpendUSD(deps.pool, tenant, [manifest.id]);
  phases.push({
    name: 'judge',
    outcome: judgment.passed ? 'passed' : 'failed',
    costUSD: Number((judgeCost - genCost).toFixed(4)),
  });

  if (judgment.passed) {
    return {
      status: 'passed',
      testPath: generation.testPath,
      pageObjectPath: generation.pageObjectPath,
    };
  }

  return {
    status: 'judge_failed',
    category: judgment.category ?? 'test_did_not_pass',
    reason: judgment.reason ?? 'Judge did not confirm outcomes',
    testPath: generation.testPath,
    pageObjectPath: generation.pageObjectPath,
  };
}
