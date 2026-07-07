import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ArtifactStore } from '../../artifacts.js';
import type { WorkerConfig } from '../../config.js';
import type { TeammateEscalation, TeammatePhaseRecord, TeammateReport } from '@poc/types';
import { withTenant, type Tenant } from '../../db.js';
import { manifestLogger } from '../../logger.js';
import { appendEvent } from '../../manifest-events.js';
import { runTriage, type TriageManifestRow } from '../triage.js';
import { enforceAssignmentBudget, sumManifestSpendUSD } from './budget.js';
import { escalationReason, normalizeEscalationCategory } from '../../env-setup.js';

export interface TeammateParentManifest {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    params: {
      repoId?: string | null;
      testPath: string;
      pageObjectPath?: string | null;
      includeGlobs?: string[] | null;
      autoApply?: boolean | null;
      maxHealAttempts?: number | null;
    };
  };
  policy?: { refuseCategories?: string[]; trustRung?: number } | null;
  budget?: { maxCostUSD?: number };
  audit: { correlationId: string };
}

export interface HealRetryLoopInput {
  parentManifest: TeammateParentManifest;
  deps: {
    pool: pg.Pool;
    artifacts: ArtifactStore;
    config: WorkerConfig;
  };
  phases: TeammatePhaseRecord[];
  eventStage?: string;
}

const DEFAULT_MAX_HEAL_ATTEMPTS = 3;
const DEFAULT_MAX_COST_USD = 2;
const RETRYABLE_CATEGORIES = new Set(['heal_did_not_pass']);

export interface TeammateLoopResult {
  reportStatus: TeammateReport['status'];
  phases: TeammatePhaseRecord[];
  childManifestIds: string[];
  escalations: TeammateEscalation[];
  summary: string;
  terminalStatus: 'succeeded' | 'rejected' | 'failed';
  result: Record<string, unknown>;
}

async function insertChildTriage(
  pool: pg.Pool,
  tenant: Tenant,
  parent: TeammateParentManifest,
  attempt: number,
  maxAttempts: number,
): Promise<TriageManifestRow> {
  const childId = randomUUID();
  const childCorrelation = randomUUID();
  const { testPath, pageObjectPath, repoId, includeGlobs, autoApply } = parent.goal.params;
  const childGoal = {
    kind: 'heal_test' as const,
    description: `Teammate heal ${testPath} (attempt ${attempt}/${maxAttempts})`,
    params: {
      testPath,
      pageObjectPath: pageObjectPath ?? null,
      repoId: repoId ?? null,
      includeGlobs: includeGlobs ?? null,
      autoApply: autoApply ?? false,
      patchNamespace: 'teammate' as const,
      patchScopeId: parent.id.slice(0, 8),
    },
  };

  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `INSERT INTO manifests (
         id, org_id, workspace_id, parent_manifest_id, role, status, workflow_id,
         goal, context, budget, success_gate, policy, audit
       )
       SELECT $1, org_id, workspace_id, $2, 'triage', 'assigned', $3,
              $4, context, budget, success_gate, policy, $5
         FROM manifests WHERE id = $2`,
      [
        childId,
        parent.id,
        `local-${childId}`,
        JSON.stringify(childGoal),
        JSON.stringify({ correlationId: childCorrelation }),
      ],
    );
  });

  return {
    id: childId,
    org_id: parent.org_id,
    workspace_id: parent.workspace_id,
    goal: childGoal,
    policy: parent.policy ?? null,
    audit: { correlationId: childCorrelation },
  };
}

async function readChildResult(
  pool: pg.Pool,
  tenant: Tenant,
  childId: string,
): Promise<Record<string, unknown> | null> {
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{ result: Record<string, unknown> | null }>(
      `SELECT result FROM manifests WHERE id = $1`,
      [childId],
    );
    return rows[0]?.result ?? null;
  });
}

export async function runHealRetryLoop(input: HealRetryLoopInput): Promise<TeammateLoopResult> {
  const { parentManifest, deps, phases } = input;
  const eventStage = input.eventStage ?? 'heal_retry_attempt';
  const tenant = { orgId: parentManifest.org_id, workspaceId: parentManifest.workspace_id };
  const log = manifestLogger(parentManifest.id, parentManifest.audit.correlationId);
  const maxAttempts = parentManifest.goal.params.maxHealAttempts ?? DEFAULT_MAX_HEAL_ATTEMPTS;
  const maxCostUSD = parentManifest.budget?.maxCostUSD ?? DEFAULT_MAX_COST_USD;
  const testPath = parentManifest.goal.params.testPath;

  const childManifestIds: string[] = [];
  const escalations: TeammateEscalation[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const budget = await enforceAssignmentBudget(
      deps.pool,
      tenant,
      parentManifest.id,
      childManifestIds,
      maxCostUSD,
    );
    if (!budget.ok) {
      escalations.push({
        category: 'over_budget',
        reason: `Assignment budget $${maxCostUSD} exceeded (spent $${budget.spent.toFixed(4)})`,
        testPath,
      });
      return {
        reportStatus: 'escalated',
        phases,
        childManifestIds,
        escalations,
        summary: `Budget exhausted after ${attempt - 1} heal attempt(s) on ${testPath}`,
        terminalStatus: 'rejected',
        result: { category: 'over_budget', testPath, spentUSD: budget.spent },
      };
    }

    const childRow = await insertChildTriage(deps.pool, tenant, parentManifest, attempt, maxAttempts);
    childManifestIds.push(childRow.id);

    let outcome: { status: 'succeeded' | 'rejected' | 'failed'; message: string };
    try {
      outcome = await runTriage(childRow, deps);
    } catch (err) {
      outcome = { status: 'failed', message: (err as Error).message };
      await withTenant(deps.pool, tenant, async (client) => {
        await client.query(
          `UPDATE manifests SET status = 'failed', finished_at = now(),
                  result = $2::jsonb
            WHERE id = $1 AND status NOT IN ('succeeded','rejected','failed','cancelled')`,
          [childRow.id, JSON.stringify({ status: 'failed', reason: outcome.message })],
        );
      });
    }

    const childResult = await readChildResult(deps.pool, tenant, childRow.id);
    const category = (childResult?.category as string | undefined) ?? null;
    const attemptCost = await sumManifestSpendUSD(deps.pool, tenant, [childRow.id]);
    phases.push({
      name: `heal_attempt_${attempt}`,
      manifestId: childRow.id,
      outcome: outcome.status,
      costUSD: Number(attemptCost.toFixed(4)),
      attempt,
    });

    await withTenant(deps.pool, tenant, async (client) => {
      await appendEvent(client, parentManifest, 'progress', null, null, {
        stage: eventStage,
        attempt,
        maxAttempts,
        childManifestId: childRow.id,
        childStatus: outcome.status,
        category,
      });
    });

    log.info({ stage: eventStage, attempt, childStatus: outcome.status, category }, 'Heal retry finished');

    if (outcome.status === 'succeeded') {
      return {
        reportStatus: 'done',
        phases,
        childManifestIds,
        escalations,
        summary: childResult?.alreadyPassing
          ? `${testPath} already passing — nothing to heal`
          : `Fixed ${testPath} on attempt ${attempt}`,
        terminalStatus: 'succeeded',
        result: {
          testPath,
          childManifestId: childRow.id,
          alreadyPassing: Boolean(childResult?.alreadyPassing),
          autoApplied: Boolean(childResult?.autoApplied),
          patchedTestPath: childResult?.patchedTestPath ?? null,
          patchedPageObjectPath: childResult?.patchedPageObjectPath ?? null,
          category,
        },
      };
    }

    if (outcome.status === 'failed') {
      escalations.push({
        category: 'infra',
        reason: outcome.message,
        testPath,
        manifestId: childRow.id,
      });
      return {
        reportStatus: 'escalated',
        phases,
        childManifestIds,
        escalations,
        summary: `Heal attempt ${attempt} failed with infrastructure error`,
        terminalStatus: 'failed',
        result: { category: 'infra', reason: outcome.message, testPath },
      };
    }

    const reason = (childResult?.reason as string | undefined) ?? outcome.message;
    const rawCategory = (childResult?.category as string | undefined) ?? null;
    const escalationCategory = normalizeEscalationCategory(rawCategory, reason);
    if (!rawCategory || !RETRYABLE_CATEGORIES.has(rawCategory)) {
      escalations.push({
        category: escalationCategory,
        reason: escalationReason(escalationCategory, reason),
        testPath,
        manifestId: childRow.id,
      });
      return {
        reportStatus: 'escalated',
        phases,
        childManifestIds,
        escalations,
        summary:
          escalationCategory === 'env_setup_required'
            ? `${testPath} needs auth/setup before it can be healed`
            : `Cannot heal ${testPath}: ${escalationCategory}`,
        terminalStatus: 'rejected',
        result: {
          category: escalationCategory,
          reason: escalationReason(escalationCategory, reason),
          testPath,
          childManifestId: childRow.id,
        },
      };
    }
  }

  escalations.push({
    category: 'heal_did_not_pass',
    reason: `Exhausted ${maxAttempts} heal attempts on ${testPath}`,
    testPath,
    manifestId: childManifestIds[childManifestIds.length - 1],
  });

  return {
    reportStatus: 'escalated',
    phases,
    childManifestIds,
    escalations,
    summary: `Could not fix ${testPath} after ${maxAttempts} attempts`,
    terminalStatus: 'rejected',
    result: {
      category: 'heal_did_not_pass',
      testPath,
      attempts: maxAttempts,
      lastChildManifestId: childManifestIds[childManifestIds.length - 1],
    },
  };
}
