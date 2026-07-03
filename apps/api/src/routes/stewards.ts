import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';

const createStewardSchema = z.object({
  repoId: z.string().uuid().optional(),
  runs: z.number().int().min(1).max(10).optional(),
});

const DEFAULT_BUDGET: ManifestBudget = {
  maxTokens: 2_000,
  maxSteps: 10,
  maxDurationSec: 1800,   // K full suite runs take real wall-clock time
  maxCostUSD: 1,
};

const DEFAULT_POLICY: ManifestPolicy = {
  trustRung: 1,
  canWritePR: false,
  canFileIssue: true,
  refuseCategories: ['unknown'],
  escalationSLA: 1800,
};

export function registerStewardsRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/stewards', async (request, reply) => {
    const parsed = createStewardSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const input = parsed.data;
    const manifestId = randomUUID();
    const correlationId = randomUUID();
    const workflowId = `local-${manifestId}`;

    const goal = {
      kind: 'suite_health' as const,
      description: `Suite health report (${input.runs ?? 3} runs)`,
      params: {
        repoId: input.repoId ?? null,
        runs: input.runs ?? null,
      },
    };

    await withTenant(db, request.tenant, async (client) => {
      await client.query(
        `INSERT INTO manifests (
           id, org_id, workspace_id, role, status, workflow_id,
           goal, context, budget, success_gate, policy, audit
         ) VALUES ($1, $2, $3, 'steward', 'pending', $4,
                   $5, $6, $7, $8, $9, $10)`,
        [
          manifestId,
          request.tenant.orgId,
          request.tenant.workspaceId,
          workflowId,
          JSON.stringify(goal),
          JSON.stringify({ memoryRefs: [], priorManifests: [] }),
          JSON.stringify(DEFAULT_BUDGET),
          JSON.stringify({ verifier: 'steward', criteria: ['health report generated'] }),
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
