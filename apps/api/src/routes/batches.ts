import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';

const createBatchSchema = z
  .object({
    specs: z.array(z.string().min(1)).max(25).optional(),
    glob: z.string().min(1).optional(),
    fromManifestId: z.string().uuid().optional(),
    repoId: z.string().uuid().optional(),
    maxCostUSD: z.number().positive().max(50).optional(),
  })
  .refine((v) => v.specs?.length || v.glob || v.fromManifestId, {
    message: 'Provide specs[], glob, or fromManifestId',
  });

const DEFAULT_BUDGET: ManifestBudget = {
  maxTokens: 200_000,
  maxSteps: 25,
  maxDurationSec: 3600,
  maxCostUSD: 5,
};

const DEFAULT_POLICY: ManifestPolicy = {
  trustRung: 1,
  canWritePR: false,
  canFileIssue: true,
  refuseCategories: ['product_bug', 'assertion_broken', 'infra', 'out_of_scope', 'unknown'],
  escalationSLA: 3600,
};

export function registerBatchesRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/batches', async (request, reply) => {
    const parsed = createBatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const input = parsed.data;

    // --from-steward: pull heal candidates (and the repo) from the steward
    // manifest's result. Recorded by the Steward workflow since v0.5.0.
    let specs = input.specs ?? [];
    let repoId = input.repoId ?? null;
    if (input.fromManifestId) {
      const source = await withTenant(db, request.tenant, async (client) => {
        const { rows } = await client.query<{
          role: string;
          status: string;
          result: Record<string, unknown> | null;
          goal: { params?: { repoId?: string | null } } | null;
        }>(`SELECT role, status, result, goal FROM manifests WHERE id = $1`, [
          input.fromManifestId,
        ]);
        return rows[0] ?? null;
      });
      if (!source) return reply.code(404).send({ error: 'fromManifestId not found' });
      if (source.role !== 'steward' || source.status !== 'succeeded') {
        return reply.code(422).send({
          error: `fromManifestId must be a succeeded steward manifest (got role=${source.role}, status=${source.status})`,
        });
      }
      const candidates = (source.result?.healCandidates as string[] | undefined) ?? null;
      if (candidates === null) {
        return reply.code(422).send({
          error:
            'This steward report predates heal candidates (v0.5.0). Re-run `agent steward` and try again.',
        });
      }
      if (candidates.length === 0) {
        return reply.code(422).send({
          error: 'Steward report has no heal candidates — nothing consistently failing with a healable category.',
        });
      }
      specs = candidates;
      repoId = repoId ?? source.goal?.params?.repoId ?? null;
    }

    const manifestId = randomUUID();
    const correlationId = randomUUID();
    const workflowId = `local-${manifestId}`;

    const goal = {
      kind: 'batch_heal' as const,
      description:
        specs.length > 0
          ? `Batch heal ${specs.length} specs`
          : `Batch heal glob ${input.glob}`,
      params: {
        repoId,
        specs: specs.length > 0 ? specs : null,
        glob: input.glob ?? null,
        fromManifestId: input.fromManifestId ?? null,
      },
    };

    const budget: ManifestBudget = {
      ...DEFAULT_BUDGET,
      ...(input.maxCostUSD !== undefined ? { maxCostUSD: input.maxCostUSD } : {}),
    };

    await withTenant(db, request.tenant, async (client) => {
      await client.query(
        `INSERT INTO manifests (
           id, org_id, workspace_id, role, status, workflow_id,
           goal, context, budget, success_gate, policy, audit
         ) VALUES ($1, $2, $3, 'orchestrator', 'pending', $4,
                   $5, $6, $7, $8, $9, $10)`,
        [
          manifestId,
          request.tenant.orgId,
          request.tenant.workspaceId,
          workflowId,
          JSON.stringify(goal),
          JSON.stringify({ memoryRefs: [], priorManifests: [] }),
          JSON.stringify(budget),
          JSON.stringify({ verifier: 'judge', criteria: ['every child reaches a terminal state'] }),
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
          JSON.stringify({ input: { ...input, resolvedSpecs: specs } }),
          correlationId,
        ],
      );
    });

    return reply.code(202).send({
      manifestId,
      workflowId,
      correlationId,
      status: 'pending',
      specCount: specs.length,
    });
  });
}
