import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { submitManifest } from '../submit-manifest.js';

const createAnalysisSchema = z.object({
  sinceHours: z.number().int().min(1).max(720).optional(),
  roleFilter: z.string().optional(),
  minClusterSize: z.number().int().min(1).max(50).optional(),
  maxRows: z.number().int().min(10).max(1000).optional(),
});

const DEFAULT_BUDGET: ManifestBudget = {
  maxTokens: 100,
  maxSteps: 3,
  maxDurationSec: 120,
  maxCostUSD: 0.01,
};

const DEFAULT_POLICY: ManifestPolicy = {
  trustRung: 1,
  canWritePR: false,
  canFileIssue: false,
  refuseCategories: [],
  escalationSLA: 600,
};

export function registerAnalysesRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/analyses', async (request, reply) => {
    const parsed = createAnalysisSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const input = parsed.data;

    const submitted = await submitManifest(db, request.tenant, request.userId, {
      role: 'analyzer',
      goal: {
        kind: 'analyze_rejections',
        description: `Cluster rejected manifests in last ${input.sinceHours ?? 168}h`,
        params: {
          sinceHours: input.sinceHours ?? 168,
          roleFilter: input.roleFilter ?? null,
          minClusterSize: input.minClusterSize ?? 2,
          maxRows: input.maxRows ?? 200,
        },
      },
      budget: DEFAULT_BUDGET,
      policy: DEFAULT_POLICY,
      successGate: {
        verifier: 'analyzer',
        criteria: ['clusters emitted', 'report artifact written'],
      },
      eventInput: input,
    });

    return reply.code(202).send(submitted);
  });
}
