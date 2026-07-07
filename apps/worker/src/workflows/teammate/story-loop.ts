import type pg from 'pg';
import type { ArtifactStore } from '../../artifacts.js';
import type { WorkerConfig } from '../../config.js';
import type { TeammatePhaseRecord } from '@poc/types';
import { manifestLogger } from '../../logger.js';
import { appendEvent } from '../../manifest-events.js';
import { withTenant } from '../../db.js';
import {
  isJudgeFailureHealable,
  runCoveragePhases,
  type CoveragePhasesManifest,
} from '../coverage-phases.js';
import { runHealRetryLoop, type TeammateLoopResult, type TeammateParentManifest } from './heal-retry-loop.js';

export interface StoryLoopInput {
  parentManifest: {
    id: string;
    org_id: string;
    workspace_id: string;
    goal: {
      description: string;
      params: {
        repoId?: string | null;
        targetUrl: string;
        expectedOutcomes: string[];
        maxSteps?: number | null;
        autoApply?: boolean | null;
        maxHealAttempts?: number | null;
      };
    };
    policy?: { refuseCategories?: string[]; trustRung?: number } | null;
    budget?: { maxCostUSD?: number };
    audit: { correlationId: string };
  };
  deps: {
    pool: pg.Pool;
    artifacts: ArtifactStore;
    config: WorkerConfig;
  };
}

export async function runStoryLoop(input: StoryLoopInput): Promise<TeammateLoopResult> {
  const { parentManifest, deps } = input;
  const log = manifestLogger(parentManifest.id, parentManifest.audit.correlationId);
  const phases: TeammatePhaseRecord[] = [];

  const coverageManifest: CoveragePhasesManifest = {
    id: parentManifest.id,
    org_id: parentManifest.org_id,
    workspace_id: parentManifest.workspace_id,
    goal: {
      description: parentManifest.goal.description,
      params: {
        targetUrl: parentManifest.goal.params.targetUrl,
        expectedOutcomes: parentManifest.goal.params.expectedOutcomes,
        maxSteps: parentManifest.goal.params.maxSteps ?? 30,
        repoId: parentManifest.goal.params.repoId ?? null,
      },
    },
    audit: parentManifest.audit,
  };

  await withTenant(deps.pool, { orgId: parentManifest.org_id, workspaceId: parentManifest.workspace_id }, async (client) => {
    await appendEvent(client, parentManifest, 'progress', null, null, {
      stage: 'story_loop_start',
      targetUrl: parentManifest.goal.params.targetUrl,
    });
  });

  const coverage = await runCoveragePhases(coverageManifest, deps, phases);
  log.info({ stage: 'story_loop_coverage', coverageStatus: coverage.status }, 'Coverage phases complete');

  if (coverage.status === 'passed') {
    return {
      reportStatus: 'done',
      phases,
      childManifestIds: [],
      escalations: [],
      summary: `Generated and verified ${coverage.testPath}`,
      terminalStatus: 'succeeded',
      result: {
        testPath: coverage.testPath,
        pageObjectPath: coverage.pageObjectPath,
        verified: true,
      },
    };
  }

  if (coverage.status === 'explore_failed' || coverage.status === 'failed') {
    return {
      reportStatus: 'escalated',
      phases,
      childManifestIds: [],
      escalations: [
        {
          category: coverage.category,
          reason: coverage.reason,
        },
      ],
      summary: coverage.reason,
      terminalStatus: 'rejected',
      result: { category: coverage.category, reason: coverage.reason },
    };
  }

  // judge_failed
  if (!isJudgeFailureHealable(coverage.category)) {
    return {
      reportStatus: 'escalated',
      phases,
      childManifestIds: [],
      escalations: [
        {
          category: coverage.category,
          reason: coverage.reason,
          testPath: coverage.testPath,
        },
      ],
      summary: `Judge failed (${coverage.category}) — not healable: ${coverage.reason}`,
      terminalStatus: 'rejected',
      result: {
        category: coverage.category,
        reason: coverage.reason,
        testPath: coverage.testPath,
        pageObjectPath: coverage.pageObjectPath,
      },
    };
  }

  const healParent: TeammateParentManifest = {
    id: parentManifest.id,
    org_id: parentManifest.org_id,
    workspace_id: parentManifest.workspace_id,
    goal: {
      params: {
        repoId: parentManifest.goal.params.repoId,
        testPath: coverage.testPath,
        pageObjectPath: coverage.pageObjectPath,
        autoApply: parentManifest.goal.params.autoApply,
        maxHealAttempts: parentManifest.goal.params.maxHealAttempts,
      },
    },
    policy: parentManifest.policy,
    budget: parentManifest.budget,
    audit: parentManifest.audit,
  };

  const healResult = await runHealRetryLoop({
    parentManifest: healParent,
    deps,
    phases,
    eventStage: 'story_loop_heal_attempt',
  });

  return {
    ...healResult,
    result: {
      ...healResult.result,
      generatedTestPath: coverage.testPath,
      generatedPageObjectPath: coverage.pageObjectPath,
      judgeCategory: coverage.category,
    },
  };
}
