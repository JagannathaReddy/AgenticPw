import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ManifestBudget,
  ManifestPolicy,
  TaskManifest,
} from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';

const createTestSchema = z.object({
  goal: z.string().min(3),
  targetUrl: z.string().url(),
  expectedOutcomes: z.array(z.string().min(1)).default([]),
  repoId: z.string().uuid().optional(),
  maxSteps: z.number().int().positive().max(100).optional(),
});

const DEFAULT_BUDGET: ManifestBudget = {
  maxTokens: 30_000,
  maxSteps: 30,
  maxDurationSec: 900,
  maxCostUSD: 5,
};

const DEFAULT_POLICY: ManifestPolicy = {
  trustRung: 1,
  canWritePR: true,
  canFileIssue: true,
  refuseCategories: ['product_bug', 'touches_payments', 'touches_auth', 'weakens_assertion'],
  escalationSLA: 900,
};

export function registerTestsRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/tests', async (request, reply) => {
    const parsed = createTestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const input = parsed.data;
    const manifestId = randomUUID();
    const correlationId = randomUUID();
    // Q1 local: workflowId is just the manifest id — no Temporal yet.
    const workflowId = `local-${manifestId}`;

    const goal = {
      kind: 'add_test' as const,
      description: input.goal,
      params: {
        targetUrl: input.targetUrl,
        expectedOutcomes: input.expectedOutcomes,
        repoId: input.repoId ?? null,
        maxSteps: input.maxSteps ?? DEFAULT_BUDGET.maxSteps,
      },
    };

    await withTenant(db, request.tenant, async (client) => {
      await client.query(
        `INSERT INTO manifests (
           id, org_id, workspace_id, role, status, workflow_id,
           goal, context, budget, success_gate, policy, audit
         ) VALUES ($1, $2, $3, 'coverage', 'pending', $4,
                   $5, $6, $7, $8, $9, $10)`,
        [
          manifestId,
          request.tenant.orgId,
          request.tenant.workspaceId,
          workflowId,
          JSON.stringify(goal),
          JSON.stringify({ memoryRefs: [], priorManifests: [] }),
          JSON.stringify(DEFAULT_BUDGET),
          JSON.stringify({ verifier: 'judge', criteria: input.expectedOutcomes }),
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

  app.get<{ Params: { id: string } }>('/v1/tests/:id', async (request, reply) => {
    const id = request.params.id;
    return withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query<TaskManifest & { events: unknown[] }>(
        `SELECT
           m.id, m.org_id AS "orgId", m.workspace_id AS "workspaceId",
           m.role, m.status, m.workflow_id AS "workflowId",
           m.goal, m.context, m.budget, m.policy, m.audit, m.result,
           m.created_at AS "createdAt", m.updated_at AS "updatedAt",
           m.started_at AS "startedAt", m.finished_at AS "finishedAt",
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'ts', ts, 'kind', kind,
               'fromStatus', from_status, 'toStatus', to_status,
               'actor', actor, 'payload', payload
             ) ORDER BY ts)
             FROM manifest_events e WHERE e.manifest_id = m.id
           ), '[]'::jsonb) AS events
         FROM manifests m WHERE m.id = $1`,
        [id],
      );

      if (rows.length === 0) {
        return reply.code(404).send({ error: 'manifest not found' });
      }
      return rows[0];
    });
  });

  app.get('/v1/tests', async (request) => {
    return withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query(
        `SELECT id, role, status, goal, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM manifests ORDER BY created_at DESC LIMIT 50`,
      );
      return rows;
    });
  });
}
