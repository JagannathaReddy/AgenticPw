import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type pg from 'pg';
import type { ArtifactStore } from '../../artifacts.js';
import type { WorkerConfig } from '../../config.js';
import type { TeammateEscalation, TeammatePhaseRecord } from '@poc/types';
import {
  computeTrends,
  type FlakyTarget,
  type SuiteHealthReport,
  type TrendDeltas,
} from '../../activities/flake-analyzer.js';
import { withTenant, type Tenant } from '../../db.js';
import { manifestLogger } from '../../logger.js';
import { appendEvent } from '../../manifest-events.js';
import { runBatch, type BatchManifestRow } from '../batch.js';
import { runQuarantine, type QuarantineManifestRow } from '../quarantine.js';
import { runSteward, type StewardManifestRow } from '../steward.js';
import { enforceAssignmentBudget, sumManifestSpendUSD } from './budget.js';
import type { TeammateLoopResult } from './heal-retry-loop.js';
import { runAuthBootstrap } from '../../activities/auth-bootstrap.js';
import { loadRepoContext } from '../../repo-context.js';
import { isEnvSetupText } from '../../env-setup.js';

export interface RegressionLoopInput {
  parentManifest: {
    id: string;
    org_id: string;
    workspace_id: string;
    goal: {
      params: {
        repoId?: string | null;
        stewardRuns?: number | null;
        verifyRuns?: number | null;
        quarantineFlaky?: boolean | null;
        autoApply?: boolean | null;
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

const DEFAULT_STEWARD_RUNS = 3;
const DEFAULT_VERIFY_RUNS = 1;
const DEFAULT_MAX_COST_USD = 10;
const BATCH_BUDGET_CAP_USD = 5;

interface ChildManifestBase {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: Record<string, unknown>;
  policy?: RegressionLoopInput['parentManifest']['policy'];
  budget?: { maxCostUSD?: number };
  audit: { correlationId: string };
}

async function insertChildManifest(
  pool: pg.Pool,
  tenant: Tenant,
  parent: RegressionLoopInput['parentManifest'],
  role: string,
  goal: Record<string, unknown>,
  budget?: { maxCostUSD?: number },
): Promise<ChildManifestBase> {
  const childId = randomUUID();
  const childCorrelation = randomUUID();
  const row: ChildManifestBase = {
    id: childId,
    org_id: parent.org_id,
    workspace_id: parent.workspace_id,
    goal,
    policy: parent.policy,
    budget,
    audit: { correlationId: childCorrelation },
  };

  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `INSERT INTO manifests (
         id, org_id, workspace_id, parent_manifest_id, role, status, workflow_id,
         goal, context, budget, success_gate, policy, audit
       )
       SELECT $1, org_id, workspace_id, $2, $3, 'assigned', $4,
              $5, context, $6, success_gate, policy, $7
         FROM manifests WHERE id = $2`,
      [
        childId,
        parent.id,
        role,
        `local-${childId}`,
        JSON.stringify(goal),
        budget ? JSON.stringify(budget) : null,
        JSON.stringify({ correlationId: childCorrelation }),
      ],
    );
  });

  return row;
}

async function readManifestResult(
  pool: pg.Pool,
  tenant: Tenant,
  manifestId: string,
): Promise<Record<string, unknown> | null> {
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{ result: Record<string, unknown> | null }>(
      `SELECT result FROM manifests WHERE id = $1`,
      [manifestId],
    );
    return rows[0]?.result ?? null;
  });
}

async function loadStewardReport(
  artifacts: ArtifactStore,
  manifestId: string,
): Promise<SuiteHealthReport | null> {
  try {
    const raw = await fs.readFile(artifacts.getPath(`${manifestId}/steward-report.json`), 'utf8');
    return JSON.parse(raw) as SuiteHealthReport;
  } catch {
    return null;
  }
}

function envSetupFailures(report: SuiteHealthReport): string[] {
  return report.tests
    .filter(
      (t) =>
        t.verdict === 'always_failing' &&
        (isEnvSetupText(t.file) ||
          t.errorHeads.some(isEnvSetupText) ||
          (t.category === 'infra' && t.errorHeads.some((h) => /timeout|setup|auth/i.test(h)))),
    )
    .map((t) => `${t.file} › ${t.title}`);
}

function decideReportStatus(
  escalations: TeammateEscalation[],
  batchPatched: number,
  trends: TrendDeltas | null,
): TeammateLoopResult['reportStatus'] {
  const fixed = trends?.fixed.length ?? 0;
  if (escalations.some((e) => e.category === 'env_setup_required') && batchPatched === 0 && fixed === 0) {
    return 'escalated';
  }
  if (escalations.length > 0) {
    return batchPatched > 0 || fixed > 0 ? 'partial' : 'escalated';
  }
  return 'done';
}

async function recordPhase(
  input: {
    pool: pg.Pool;
    tenant: Tenant;
    parent: RegressionLoopInput['parentManifest'];
    phases: TeammatePhaseRecord[];
    childManifestIds: string[];
    name: string;
    childId: string;
    outcome: string;
  },
): Promise<void> {
  const costUSD = await sumManifestSpendUSD(input.pool, input.tenant, [input.childId]);
  input.phases.push({
    name: input.name,
    manifestId: input.childId,
    outcome: input.outcome,
    costUSD: Number(costUSD.toFixed(4)),
  });
  input.childManifestIds.push(input.childId);
}

async function runStewardBaseline(
  deps: RegressionLoopInput['deps'],
  tenant: Tenant,
  parentManifest: RegressionLoopInput['parentManifest'],
  phases: TeammatePhaseRecord[],
  childManifestIds: string[],
  repoId: string | null,
  stewardRuns: number,
  phaseName: string,
  descriptionSuffix: string,
): Promise<{
  child: ChildManifestBase;
  row: StewardManifestRow;
  outcome: { status: 'succeeded' | 'rejected' | 'failed'; message: string };
  result: Record<string, unknown> | null;
  report: SuiteHealthReport | null;
}> {
  const stewardGoal = {
    kind: 'suite_health',
    description: `Regression baseline steward (${stewardRuns} runs)${descriptionSuffix}`,
    params: { repoId, runs: stewardRuns },
  };
  const stewardChild = await insertChildManifest(
    deps.pool,
    tenant,
    parentManifest,
    'steward',
    stewardGoal,
  );
  const stewardRow: StewardManifestRow = {
    id: stewardChild.id,
    org_id: stewardChild.org_id,
    workspace_id: stewardChild.workspace_id,
    goal: stewardGoal as StewardManifestRow['goal'],
    audit: stewardChild.audit,
  };

  let stewardOutcome: { status: 'succeeded' | 'rejected' | 'failed'; message: string };
  try {
    stewardOutcome = await runSteward(stewardRow, deps);
  } catch (err) {
    stewardOutcome = { status: 'failed', message: (err as Error).message };
  }

  const stewardResult = await readManifestResult(deps.pool, tenant, stewardChild.id);
  await recordPhase({
    pool: deps.pool,
    tenant,
    parent: parentManifest,
    phases,
    childManifestIds,
    name: phaseName,
    childId: stewardChild.id,
    outcome: stewardOutcome.status,
  });

  const report = await loadStewardReport(deps.artifacts, stewardChild.id);
  return {
    child: stewardChild,
    row: stewardRow,
    outcome: stewardOutcome,
    result: stewardResult,
    report,
  };
}

async function tryAuthBootstrap(
  input: RegressionLoopInput,
  tenant: Tenant,
  parentManifest: RegressionLoopInput['parentManifest'],
  repoId: string | null,
  phases: TeammatePhaseRecord[],
): Promise<{ ok: boolean; storageStatesFound: string[]; errors: string[] }> {
  const repo = await loadRepoContext(input.deps.pool, tenant, input.deps.config, repoId);
  const result = await runAuthBootstrap({
    repoRoot: repo.repoRoot,
    timeoutMs: input.deps.config.testTimeoutMs * 2,
  });

  phases.push({
    name: 'auth_bootstrap',
    manifestId: parentManifest.id,
    outcome: result.ok ? 'succeeded' : 'rejected',
    costUSD: 0,
  });

  await withTenant(input.deps.pool, tenant, async (client) => {
    await appendEvent(client, parentManifest, 'progress', null, null, {
      stage: 'auth_bootstrap',
      ok: result.ok,
      setupProjectsRun: result.setupProjectsRun,
      storageStatesFound: result.storageStatesFound,
      errors: result.errors,
    });
  });

  return { ok: result.ok, storageStatesFound: result.storageStatesFound, errors: result.errors };
}

export async function runRegressionLoop(input: RegressionLoopInput): Promise<TeammateLoopResult> {
  const { parentManifest, deps } = input;
  const tenant = { orgId: parentManifest.org_id, workspaceId: parentManifest.workspace_id };
  const log = manifestLogger(parentManifest.id, parentManifest.audit.correlationId);
  const repoId = parentManifest.goal.params.repoId ?? null;
  const stewardRuns = parentManifest.goal.params.stewardRuns ?? DEFAULT_STEWARD_RUNS;
  const verifyRuns = parentManifest.goal.params.verifyRuns ?? DEFAULT_VERIFY_RUNS;
  const quarantineFlaky = parentManifest.goal.params.quarantineFlaky ?? true;
  const autoApply = parentManifest.goal.params.autoApply ?? false;
  const maxCostUSD = parentManifest.budget?.maxCostUSD ?? DEFAULT_MAX_COST_USD;

  const phases: TeammatePhaseRecord[] = [];
  const childManifestIds: string[] = [];
  const escalations: TeammateEscalation[] = [];

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, parentManifest, 'progress', null, null, {
      stage: 'regression_loop_start',
      repoId,
      stewardRuns,
    });
  });

  // ── 1. Initial steward ─────────────────────────────────────────────────
  let baseline = await runStewardBaseline(
    deps,
    tenant,
    parentManifest,
    phases,
    childManifestIds,
    repoId,
    stewardRuns,
    'steward_baseline',
    '',
  );

  log.info(
    { stage: 'steward_baseline', status: baseline.outcome.status },
    'Baseline steward finished',
  );

  if (baseline.outcome.status !== 'succeeded') {
    const reason = (baseline.result?.reason as string | undefined) ?? baseline.outcome.message;
    let category =
      baseline.result?.category === 'no_results' && isEnvSetupText(reason)
        ? 'env_setup_required'
        : ((baseline.result?.category as string | undefined) ?? 'steward_failed');

    if (category === 'env_setup_required') {
      const auth = await tryAuthBootstrap({ parentManifest, deps }, tenant, parentManifest, repoId, phases);
      if (auth.ok) {
        baseline = await runStewardBaseline(
          deps,
          tenant,
          parentManifest,
          phases,
          childManifestIds,
          repoId,
          stewardRuns,
          'steward_baseline_retry',
          ' after auth bootstrap',
        );
      }
    }

    if (baseline.outcome.status !== 'succeeded') {
      escalations.push({ category, reason });
      return {
        reportStatus: category === 'env_setup_required' ? 'escalated' : 'escalated',
        phases,
        childManifestIds,
        escalations,
        summary: `Baseline steward failed: ${reason}`,
        terminalStatus: baseline.outcome.status === 'failed' ? 'failed' : 'rejected',
        result: { category, reason, stewardManifestId: baseline.child.id },
      };
    }
  }

  let stewardChild = baseline.child;
  let stewardResult = baseline.result;
  let baselineReport = baseline.report;
  let healCandidates = (stewardResult?.healCandidates as string[] | undefined) ?? [];
  let flakyTests = (stewardResult?.flakyTests as FlakyTarget[] | undefined) ?? [];
  let envFailures = baselineReport ? envSetupFailures(baselineReport) : [];

  if (envFailures.length > 0) {
    const auth = await tryAuthBootstrap({ parentManifest, deps }, tenant, parentManifest, repoId, phases);
    if (auth.ok) {
      const retry = await runStewardBaseline(
        deps,
        tenant,
        parentManifest,
        phases,
        childManifestIds,
        repoId,
        stewardRuns,
        'steward_baseline_retry',
        ' after auth bootstrap',
      );
      if (retry.outcome.status === 'succeeded') {
        stewardChild = retry.child;
        stewardResult = retry.result;
        baselineReport = retry.report;
        healCandidates = (stewardResult?.healCandidates as string[] | undefined) ?? [];
        flakyTests = (stewardResult?.flakyTests as FlakyTarget[] | undefined) ?? [];
        envFailures = baselineReport ? envSetupFailures(baselineReport) : [];
      }
    }

    if (envFailures.length > 0) {
      escalations.push({
        category: 'env_setup_required',
        reason: `${envFailures.length} test(s) need auth/setup (.auth, globalSetup, storageState): ${envFailures.slice(0, 5).join('; ')}${envFailures.length > 5 ? '…' : ''}. Try: npm run agent -- auth-bootstrap --repo <shortId>`,
      });
    }
  }

  // ── 2. Batch heal safe candidates ──────────────────────────────────────
  let batchPatched = 0;
  let batchChildId: string | null = null;

  if (healCandidates.length > 0) {
    const budget = await enforceAssignmentBudget(deps.pool, tenant, parentManifest.id, childManifestIds, maxCostUSD);
    if (!budget.ok) {
      escalations.push({
        category: 'over_budget',
        reason: `Assignment budget $${maxCostUSD} exceeded before batch heal (spent $${budget.spent.toFixed(4)})`,
      });
    } else {
      const batchBudget = Math.min(BATCH_BUDGET_CAP_USD, maxCostUSD - budget.spent);
      const batchGoal = {
        kind: 'batch_heal',
        description: `Regression batch heal ${healCandidates.length} specs`,
        params: { repoId, specs: healCandidates, fromManifestId: stewardChild.id },
      };
      const batchChild = await insertChildManifest(deps.pool, tenant, parentManifest, 'orchestrator', batchGoal, {
        maxCostUSD: batchBudget,
      });
      batchChildId = batchChild.id;

      const batchRow: BatchManifestRow = {
        id: batchChild.id,
        org_id: batchChild.org_id,
        workspace_id: batchChild.workspace_id,
        goal: batchGoal as BatchManifestRow['goal'],
        budget: { maxCostUSD: batchBudget },
        policy: batchChild.policy,
        audit: batchChild.audit,
      };

      let batchOutcome: { status: 'succeeded' | 'rejected' | 'failed'; message: string };
      try {
        batchOutcome = await runBatch(batchRow, deps);
      } catch (err) {
        batchOutcome = { status: 'failed', message: (err as Error).message };
      }

      const batchResult = await readManifestResult(deps.pool, tenant, batchChild.id);
      batchPatched = (batchResult?.patched as number | undefined) ?? 0;

      await recordPhase({
        pool: deps.pool,
        tenant,
        parent: parentManifest,
        phases,
        childManifestIds,
        name: 'batch_heal',
        childId: batchChild.id,
        outcome: batchOutcome.status,
      });
      log.info({ stage: 'batch_heal', patched: batchPatched, candidates: healCandidates.length }, 'Batch heal finished');
    }
  } else {
    phases.push({ name: 'batch_heal', outcome: 'skipped', costUSD: 0 });
  }

  // ── 3. Optional quarantine ─────────────────────────────────────────────
  if (quarantineFlaky && flakyTests.length > 0) {
    const budget = await enforceAssignmentBudget(deps.pool, tenant, parentManifest.id, childManifestIds, maxCostUSD);
    if (!budget.ok) {
      escalations.push({
        category: 'over_budget',
        reason: `Assignment budget $${maxCostUSD} exceeded before quarantine (spent $${budget.spent.toFixed(4)})`,
      });
    } else {
      const quarantineGoal = {
        kind: 'quarantine_flaky',
        description: `Regression quarantine ${flakyTests.length} flaky tests`,
        params: {
          repoId,
          stewardManifestId: stewardChild.id,
          targets: flakyTests,
          autoApply,
        },
      };
      const quarantineChild = await insertChildManifest(
        deps.pool,
        tenant,
        parentManifest,
        'quarantiner',
        quarantineGoal,
      );
      const quarantineRow: QuarantineManifestRow = {
        id: quarantineChild.id,
        org_id: quarantineChild.org_id,
        workspace_id: quarantineChild.workspace_id,
        goal: quarantineGoal as QuarantineManifestRow['goal'],
        policy: quarantineChild.policy,
        audit: quarantineChild.audit,
      };

      let quarantineOutcome: { status: 'succeeded' | 'rejected' | 'failed'; message: string };
      try {
        quarantineOutcome = await runQuarantine(quarantineRow, deps);
      } catch (err) {
        quarantineOutcome = { status: 'failed', message: (err as Error).message };
      }

      await recordPhase({
        pool: deps.pool,
        tenant,
        parent: parentManifest,
        phases,
        childManifestIds,
        name: 'quarantine',
        childId: quarantineChild.id,
        outcome: quarantineOutcome.status,
      });
      log.info({ stage: 'quarantine', targets: flakyTests.length }, 'Quarantine finished');
    }
  } else if (flakyTests.length > 0) {
    phases.push({ name: 'quarantine', outcome: 'skipped', costUSD: 0 });
  }

  // ── 4. Verify steward ──────────────────────────────────────────────────
  const verifyGoal = {
    kind: 'suite_health',
    description: `Regression verify steward (${verifyRuns} run${verifyRuns === 1 ? '' : 's'})`,
    params: { repoId, runs: verifyRuns },
  };
  const verifyChild = await insertChildManifest(deps.pool, tenant, parentManifest, 'steward', verifyGoal);
  const verifyRow: StewardManifestRow = {
    id: verifyChild.id,
    org_id: verifyChild.org_id,
    workspace_id: verifyChild.workspace_id,
    goal: verifyGoal as StewardManifestRow['goal'],
    audit: verifyChild.audit,
  };

  let verifyOutcome: { status: 'succeeded' | 'rejected' | 'failed'; message: string };
  try {
    verifyOutcome = await runSteward(verifyRow, deps);
  } catch (err) {
    verifyOutcome = { status: 'failed', message: (err as Error).message };
  }

  const verifyResult = await readManifestResult(deps.pool, tenant, verifyChild.id);
  await recordPhase({
    pool: deps.pool,
    tenant,
    parent: parentManifest,
    phases,
    childManifestIds,
    name: 'steward_verify',
    childId: verifyChild.id,
    outcome: verifyOutcome.status,
  });

  // ── 5. Delta report ────────────────────────────────────────────────────
  let trends: TrendDeltas | null = null;
  const verifyReport = await loadStewardReport(deps.artifacts, verifyChild.id);
  if (baselineReport && verifyReport) {
    trends = computeTrends(verifyReport, baselineReport, new Date().toISOString().slice(0, 10));
  }

  const baselineHealthy = (stewardResult?.healthy as number | undefined) ?? baselineReport?.healthy ?? 0;
  const baselineAlwaysFailing = (stewardResult?.alwaysFailing as number | undefined) ?? baselineReport?.alwaysFailing ?? 0;
  const verifyHealthy = (verifyResult?.healthy as number | undefined) ?? verifyReport?.healthy ?? 0;
  const verifyAlwaysFailing = (verifyResult?.alwaysFailing as number | undefined) ?? verifyReport?.alwaysFailing ?? 0;

  const reportStatus = decideReportStatus(escalations, batchPatched, trends);
  const fixedCount = trends?.fixed.length ?? 0;
  const stillBroken = trends?.stillBroken.length ?? verifyAlwaysFailing;

  const summaryParts = [
    `Baseline: ${baselineHealthy} healthy, ${baselineAlwaysFailing} always failing`,
    healCandidates.length > 0 ? `Healed ${batchPatched}/${healCandidates.length} candidates` : null,
    fixedCount > 0 ? `${fixedCount} test(s) fixed since baseline` : null,
    stillBroken > 0 ? `${stillBroken} still broken` : null,
    envFailures.length > 0 ? `${envFailures.length} need env setup` : null,
  ].filter(Boolean);

  const summary = summaryParts.join(' · ') || 'Regression loop complete';

  const terminalStatus: TeammateLoopResult['terminalStatus'] =
    verifyOutcome.status === 'failed' ? 'failed' : reportStatus === 'escalated' ? 'rejected' : 'succeeded';

  return {
    reportStatus,
    phases,
    childManifestIds,
    escalations,
    summary,
    terminalStatus,
    result: {
      baselineStewardId: stewardChild.id,
      verifyStewardId: verifyChild.id,
      batchManifestId: batchChildId,
      baseline: {
        healthy: baselineHealthy,
        flaky: stewardResult?.flaky ?? baselineReport?.flaky ?? 0,
        alwaysFailing: baselineAlwaysFailing,
        healCandidates: healCandidates.length,
      },
      verify: {
        healthy: verifyHealthy,
        flaky: verifyResult?.flaky ?? verifyReport?.flaky ?? 0,
        alwaysFailing: verifyAlwaysFailing,
      },
      batchPatched,
      envSetupCount: envFailures.length,
      trends,
    },
  };
}
