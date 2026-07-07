import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import type { TeammateAssignmentType, TeammateReport } from '@poc/types';
import { withTenant, type Tenant } from '../db.js';
import { manifestLogger } from '../logger.js';
import {
  appendEvent,
  startManifest,
  terminateManifest,
  type WorkflowTerminal,
} from '../manifest-events.js';
import { updateAssignmentStatus } from './teammate/assignment-state.js';
import { sumManifestSpendUSD } from './teammate/budget.js';
import { runHealthLoop } from './teammate/health-loop.js';
import type { TeammateLoopResult } from './teammate/heal-retry-loop.js';
import { postTeammateWebhook } from './teammate/notify.js';
import { runReactLoop } from './teammate/react-loop.js';
import { runRegressionLoop } from './teammate/regression-loop.js';
import { runStoryLoop } from './teammate/story-loop.js';

export interface TeammateManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      assignmentType: TeammateAssignmentType;
      assignmentId?: string;
      repoId?: string | null;
      title?: string;
      testPath?: string;
      pageObjectPath?: string | null;
      targetUrl?: string;
      expectedOutcomes?: string[];
      maxSteps?: number | null;
      includeGlobs?: string[] | null;
      autoApply?: boolean | null;
      maxHealAttempts?: number | null;
      stewardRuns?: number | null;
      verifyRuns?: number | null;
      quarantineFlaky?: boolean | null;
    };
  };
  budget?: { maxCostUSD?: number };
  policy?: { refuseCategories?: string[]; trustRung?: number } | null;
  audit: { correlationId: string };
}

export interface TeammateDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

async function finalizeTeammate(
  manifest: TeammateManifestRow,
  deps: TeammateDeps,
  loopResult: TeammateLoopResult,
  assignmentType: TeammateAssignmentType,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const trustRung = manifest.policy?.trustRung ?? 1;

  const totalCostUSD = await sumManifestSpendUSD(deps.pool, tenant, [
    manifest.id,
    ...loopResult.childManifestIds,
  ]);

  const report: TeammateReport = {
    assignmentType,
    status: loopResult.reportStatus,
    phases: loopResult.phases,
    childManifestIds: loopResult.childManifestIds,
    summary: loopResult.summary,
    escalations: loopResult.escalations,
    totalCostUSD: Number(totalCostUSD.toFixed(4)),
    trustRung: trustRung as TeammateReport['trustRung'],
    result: loopResult.result,
  };

  await deps.artifacts.put(`${manifest.id}/teammate-report.json`, JSON.stringify(report, null, 2));

  const assignmentStatus =
    loopResult.reportStatus === 'done'
      ? 'done'
      : loopResult.reportStatus === 'partial' || loopResult.reportStatus === 'escalated'
        ? 'needs_you'
        : 'failed';

  await updateAssignmentStatus(deps.pool, tenant, manifest.id, assignmentStatus, {
    loopState: { phases: loopResult.phases, childManifestIds: loopResult.childManifestIds },
    escalation: loopResult.escalations[0] ?? null,
    completed: true,
  });

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'teammate_report',
      reportStatus: loopResult.reportStatus,
      summary: loopResult.summary,
      totalCostUSD: report.totalCostUSD,
      escalationCount: loopResult.escalations.length,
    });
  });

  const webhookUrl = deps.config.notifyWebhookUrl.trim();
  if (webhookUrl) {
    try {
      const meta = await withTenant(deps.pool, tenant, async (client) => {
        const { rows } = await client.query<{
          id: string;
          title: string;
          source: string;
          repo_name: string;
        }>(
          `SELECT a.id, a.title, a.source, r.full_name AS repo_name
             FROM qa_assignments a
             JOIN repositories r ON r.id = a.repo_id
            WHERE a.manifest_id = $1`,
          [manifest.id],
        );
        return rows[0] ?? null;
      });
      if (meta) {
        await postTeammateWebhook(webhookUrl, {
          repoName: meta.repo_name,
          title: meta.title,
          assignmentType,
          assignmentId: meta.id,
          manifestId: manifest.id,
          reportStatus: loopResult.reportStatus,
          summary: loopResult.summary,
          escalations: loopResult.escalations,
          totalCostUSD: report.totalCostUSD,
          source: meta.source,
        });
      }
    } catch (err) {
      log.warn({ stage: 'webhook_notify', err: (err as Error).message }, 'Webhook notify failed');
    }
  }

  return terminate(deps.pool, tenant, manifest, loopResult.terminalStatus, {
    assignmentType,
    reportStatus: loopResult.reportStatus,
    summary: loopResult.summary,
    escalations: loopResult.escalations,
    totalCostUSD: report.totalCostUSD,
    childManifestIds: loopResult.childManifestIds,
    ...loopResult.result,
  });
}

export async function runTeammate(
  manifest: TeammateManifestRow,
  deps: TeammateDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const assignmentType = manifest.goal.params.assignmentType;

  await startManifest(deps.pool, tenant, manifest, {
    stage: 'started',
    workflow: 'teammate',
    assignmentType,
    repoId: manifest.goal.params.repoId ?? null,
  });
  log.info({ stage: 'started', assignmentType }, 'Teammate assignment started');

  if (assignmentType === 'fix_failure') {
    const testPath = manifest.goal.params.testPath;
    if (!testPath) {
      return terminate(deps.pool, tenant, manifest, 'rejected', {
        category: 'invalid_assignment',
        reason: 'fix_failure requires testPath',
      });
    }
    const loopResult = await runReactLoop({
      parentManifest: {
        id: manifest.id,
        org_id: manifest.org_id,
        workspace_id: manifest.workspace_id,
        goal: { params: { ...manifest.goal.params, testPath } },
        policy: manifest.policy,
        budget: manifest.budget,
        audit: manifest.audit,
      },
      deps,
    });
    return finalizeTeammate(manifest, deps, loopResult, assignmentType);
  }

  if (assignmentType === 'automate_story') {
    const targetUrl = manifest.goal.params.targetUrl;
    const expectedOutcomes = manifest.goal.params.expectedOutcomes ?? [];
    if (!targetUrl) {
      return terminate(deps.pool, tenant, manifest, 'rejected', {
        category: 'invalid_assignment',
        reason: 'automate_story requires targetUrl',
      });
    }
    if (expectedOutcomes.length === 0) {
      return terminate(deps.pool, tenant, manifest, 'rejected', {
        category: 'invalid_assignment',
        reason: 'automate_story requires at least one expectedOutcome',
      });
    }
    const loopResult = await runStoryLoop({
      parentManifest: {
        id: manifest.id,
        org_id: manifest.org_id,
        workspace_id: manifest.workspace_id,
        goal: {
          description: manifest.goal.description,
          params: {
            repoId: manifest.goal.params.repoId,
            targetUrl,
            expectedOutcomes,
            maxSteps: manifest.goal.params.maxSteps,
            autoApply: manifest.goal.params.autoApply,
            maxHealAttempts: manifest.goal.params.maxHealAttempts,
          },
        },
        policy: manifest.policy,
        budget: manifest.budget,
        audit: manifest.audit,
      },
      deps,
    });
    return finalizeTeammate(manifest, deps, loopResult, assignmentType);
  }

  if (assignmentType === 'regression') {
    const loopResult = await runRegressionLoop({
      parentManifest: {
        id: manifest.id,
        org_id: manifest.org_id,
        workspace_id: manifest.workspace_id,
        goal: {
          params: {
            repoId: manifest.goal.params.repoId,
            stewardRuns: manifest.goal.params.stewardRuns,
            verifyRuns: manifest.goal.params.verifyRuns,
            quarantineFlaky: manifest.goal.params.quarantineFlaky,
            autoApply: manifest.goal.params.autoApply,
          },
        },
        policy: manifest.policy,
        budget: manifest.budget,
        audit: manifest.audit,
      },
      deps,
    });
    return finalizeTeammate(manifest, deps, loopResult, assignmentType);
  }

  if (assignmentType === 'health_check') {
    const loopResult = await runHealthLoop({
      parentManifest: {
        id: manifest.id,
        org_id: manifest.org_id,
        workspace_id: manifest.workspace_id,
        goal: {
          params: {
            repoId: manifest.goal.params.repoId,
            stewardRuns: manifest.goal.params.stewardRuns,
          },
        },
        audit: manifest.audit,
      },
      deps,
    });
    return finalizeTeammate(manifest, deps, loopResult, assignmentType);
  }

  await updateAssignmentStatus(deps.pool, tenant, manifest.id, 'failed', {
    escalation: {
      category: 'unsupported_assignment',
      reason: `Assignment type "${assignmentType}" is not implemented yet`,
    },
    completed: true,
  });
  return terminate(deps.pool, tenant, manifest, 'rejected', {
    category: 'unsupported_assignment',
    reason: `Assignment type "${assignmentType}" is not implemented yet`,
  });
}

const terminate = (
  pool: pg.Pool,
  tenant: Tenant,
  manifest: TeammateManifestRow,
  status: WorkflowTerminal,
  result: Record<string, unknown>,
) => terminateManifest(pool, tenant, manifest, status, result, 'Teammate assignment complete');
