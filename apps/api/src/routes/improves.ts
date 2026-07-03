import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';

const createImproveSchema = z.object({
  testPath: z.string().min(1),
  pageObjectPath: z.string().optional(),
  repoId: z.string().uuid().optional(),
});

const DEFAULT_BUDGET: ManifestBudget = {
  maxTokens: 8_000,
  maxSteps: 1,
  maxDurationSec: 300,
  maxCostUSD: 2,
};

const DEFAULT_POLICY: ManifestPolicy = {
  trustRung: 1,
  canWritePR: false,
  canFileIssue: false,
  // Improver has its own refusal taxonomy (not_a_playwright_test / nothing_to_improve)
  // that lives in the workflow — the policy is a placeholder using the shared enum.
  refuseCategories: ['unknown'],
  escalationSLA: 300,
};

export function registerImprovesRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/improves', async (request, reply) => {
    const parsed = createImproveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const input = parsed.data;
    const manifestId = randomUUID();
    const correlationId = randomUUID();
    const workflowId = `local-${manifestId}`;

    const goal = {
      kind: 'improve_test' as const,
      description: `Improve existing spec ${input.testPath}`,
      params: {
        testPath: input.testPath,
        pageObjectPath: input.pageObjectPath ?? null,
        repoId: input.repoId ?? null,
      },
    };

    await withTenant(db, request.tenant, async (client) => {
      await client.query(
        `INSERT INTO manifests (
           id, org_id, workspace_id, role, status, workflow_id,
           goal, context, budget, success_gate, policy, audit
         ) VALUES ($1, $2, $3, 'improver', 'pending', $4,
                   $5, $6, $7, $8, $9, $10)`,
        [
          manifestId,
          request.tenant.orgId,
          request.tenant.workspaceId,
          workflowId,
          JSON.stringify(goal),
          JSON.stringify({ memoryRefs: [], priorManifests: [] }),
          JSON.stringify(DEFAULT_BUDGET),
          JSON.stringify({ verifier: 'judge', criteria: ['improved test still passes'] }),
          JSON.stringify(DEFAULT_POLICY),
          JSON.stringify({ correlationId }),
        ],
      );

      await client.query(
        `INSERT INTO manifest_events (manifest_id, workspace_id, kind, from_status, to_status, actor, payload, correlation_id)
         VALUES ($1, $2, 'created', NULL, 'pending', $3, $4::jsonb, $5)`,
        [
          manifestId,
          request.tenant.workspaceId,
          `user:${request.userId}`,
          JSON.stringify({ input }),
          correlationId,
        ],
      );
    });

    return reply.code(202).send({
      manifestId,
      workflowId,
      correlationId,
      status: 'pending',
    });
  });
}
