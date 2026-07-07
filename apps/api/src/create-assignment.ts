import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { TenantContext } from './db.js';
import { insertManifestRows } from './submit-manifest.js';

export const createAssignmentSchema = z
  .object({
    type: z.enum(['automate_story', 'regression', 'fix_failure', 'health_check']),
    repoId: z.string().uuid(),
    title: z.string().min(1).max(500).optional(),
    testPath: z.string().min(1).optional(),
    pageObjectPath: z.string().optional(),
    includeGlobs: z.array(z.string().min(1)).max(20).optional(),
    autoApply: z.boolean().optional(),
    maxCostUSD: z.number().positive().max(50).optional(),
    maxHealAttempts: z.number().int().min(1).max(10).optional(),
    goal: z.string().min(1).max(2000).optional(),
    targetUrl: z.string().url().optional(),
    expectedOutcomes: z.array(z.string().min(1)).max(20).optional(),
    maxSteps: z.number().int().min(1).max(100).optional(),
    stewardRuns: z.number().int().min(1).max(10).optional(),
    verifyRuns: z.number().int().min(1).max(5).optional(),
    quarantineFlaky: z.boolean().optional(),
    source: z.enum(['human', 'ci', 'schedule', 'api']).optional(),
    skipIfActive: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'fix_failure' && !val.testPath) {
      ctx.addIssue({ code: 'custom', message: 'fix_failure requires testPath' });
    }
    if (val.type === 'automate_story') {
      if (!val.targetUrl) {
        ctx.addIssue({ code: 'custom', message: 'automate_story requires targetUrl' });
      }
      if (!val.expectedOutcomes?.length) {
        ctx.addIssue({ code: 'custom', message: 'automate_story requires expectedOutcomes' });
      }
    }
  });

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

const DEFAULT_BUDGET: ManifestBudget = {
  maxTokens: 8_000,
  maxSteps: 5,
  maxDurationSec: 900,
  maxCostUSD: 2,
};

const DEFAULT_POLICY: ManifestPolicy = {
  trustRung: 1,
  canWritePR: false,
  canFileIssue: true,
  refuseCategories: ['product_bug', 'assertion_broken', 'infra', 'out_of_scope', 'unknown'],
  escalationSLA: 300,
};

function policyForAssignment(input: CreateAssignmentInput): ManifestPolicy {
  const trustRung = (input.autoApply ?? false) ? 2 : 1;
  // fix_failure: user picked a spec — let triage classify env/infra and escalate
  // with actionable hints instead of blocking at the policy gate.
  const refuseCategories: ManifestPolicy['refuseCategories'] =
    input.type === 'fix_failure'
      ? ['product_bug', 'assertion_broken', 'out_of_scope']
      : DEFAULT_POLICY.refuseCategories;
  return { ...DEFAULT_POLICY, trustRung, refuseCategories };
}

function defaultTitle(input: CreateAssignmentInput): string {
  if (input.title) return input.title;
  if (input.type === 'fix_failure') return `Fix ${input.testPath}`;
  if (input.type === 'automate_story') return input.goal?.slice(0, 120) ?? 'Automate user story';
  if (input.type === 'regression') return 'Full regression QA';
  if (input.type === 'health_check') return 'Suite health check';
  return 'Teammate assignment';
}

function budgetForAssignmentType(type: CreateAssignmentInput['type']): ManifestBudget {
  if (type === 'automate_story') {
    return { maxTokens: 16_000, maxSteps: 10, maxDurationSec: 1800, maxCostUSD: 5 };
  }
  if (type === 'regression') {
    return { maxTokens: 200_000, maxSteps: 25, maxDurationSec: 3600, maxCostUSD: 10 };
  }
  if (type === 'health_check') {
    return { maxTokens: 50_000, maxSteps: 10, maxDurationSec: 2400, maxCostUSD: 3 };
  }
  return DEFAULT_BUDGET;
}

export async function createAssignment(
  client: pg.PoolClient,
  tenant: TenantContext,
  userId: string,
  input: CreateAssignmentInput,
): Promise<
  | { ok: true; assignmentId: string; manifestId: string; correlationId: string; title: string; assignmentType: string }
  | { ok: false; reason: 'active_assignment_exists'; existingAssignmentId: string; manifestId: string }
> {
  if (input.skipIfActive) {
    const { rows } = await client.query<{ id: string; manifest_id: string }>(
      `SELECT id, manifest_id FROM qa_assignments
        WHERE repo_id = $1 AND assignment_type = $2 AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
      [input.repoId, input.type],
    );
    if (rows[0]) {
      return {
        ok: false,
        reason: 'active_assignment_exists',
        existingAssignmentId: rows[0].id,
        manifestId: rows[0].manifest_id,
      };
    }
  }

  const autoApply = input.autoApply ?? false;
  const title = defaultTitle(input);
  const storyDescription = input.type === 'automate_story' ? (input.goal ?? title) : title;

  const submitted = await insertManifestRows(client, tenant, userId, {
    role: 'teammate',
    goal: {
      kind: 'teammate_assignment',
      description: storyDescription,
      params: {
        assignmentType: input.type,
        repoId: input.repoId,
        title,
        testPath: input.testPath ?? null,
        pageObjectPath: input.pageObjectPath ?? null,
        includeGlobs: input.includeGlobs ?? null,
        targetUrl: input.targetUrl ?? null,
        expectedOutcomes: input.expectedOutcomes ?? [],
        maxSteps: input.maxSteps ?? 30,
        autoApply,
        maxHealAttempts: input.maxHealAttempts ?? 3,
        stewardRuns: input.stewardRuns ?? 3,
        verifyRuns: input.verifyRuns ?? 1,
        quarantineFlaky: input.quarantineFlaky ?? true,
      },
    },
    budget: {
      ...budgetForAssignmentType(input.type),
      ...(input.maxCostUSD !== undefined ? { maxCostUSD: input.maxCostUSD } : {}),
    },
    policy: policyForAssignment(input),
    successGate: { verifier: 'judge', criteria: ['assignment complete or escalated'] },
    eventInput: input,
  });

  const assignmentId = randomUUID();
  await client.query(
    `INSERT INTO qa_assignments
       (id, workspace_id, manifest_id, repo_id, assignment_type, title, status, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
    [
      assignmentId,
      tenant.workspaceId,
      submitted.manifestId,
      input.repoId,
      input.type,
      title,
      input.source ?? 'human',
    ],
  );

  return {
    ok: true,
    assignmentId,
    manifestId: submitted.manifestId,
    correlationId: submitted.correlationId,
    title,
    assignmentType: input.type,
  };
}
