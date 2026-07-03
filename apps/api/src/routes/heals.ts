import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';

const createHealSchema = z.object({
  testPath: z.string().min(1),
  pageObjectPath: z.string().optional(),
  repoId: z.string().uuid().optional(),
  includeGlobs: z.array(z.string().min(1)).max(20).optional(),
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
  canFileIssue: true,
  refuseCategories: ['product_bug', 'assertion_broken', 'infra', 'out_of_scope', 'unknown'],
  escalationSLA: 300,
};

export function registerHealsRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/heals', async (request, reply) => {
    const parsed = createHealSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const input = parsed.data;
    const manifestId = randomUUID();
    const correlationId = randomUUID();
    const workflowId = `local-${manifestId}`;

    const goal = {
      kind: 'heal_test' as const,
      description: `Triage failing test ${input.testPath}`,
      params: {
        testPath: input.testPath,
        pageObjectPath: input.pageObjectPath ?? null,
        repoId: input.repoId ?? null,
        includeGlobs: input.includeGlobs ?? null,
      },
    };

    await withTenant(db, request.tenant, async (client) => {
      await client.query(
        `INSERT INTO manifests (
           id, org_id, workspace_id, role, status, workflow_id,
           goal, context, budget, success_gate, policy, audit
         ) VALUES ($1, $2, $3, 'triage', 'pending', $4,
                   $5, $6, $7, $8, $9, $10)`,
        [
          manifestId,
          request.tenant.orgId,
          request.tenant.workspaceId,
          workflowId,
          JSON.stringify(goal),
          JSON.stringify({ memoryRefs: [], priorManifests: [] }),
          JSON.stringify(DEFAULT_BUDGET),
          JSON.stringify({ verifier: 'judge', criteria: ['patched test passes'] }),
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
