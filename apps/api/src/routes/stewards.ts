import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { submitManifest } from '../submit-manifest.js';

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

    const submitted = await submitManifest(db, request.tenant, request.userId, {
      role: 'steward',
      goal: {
        kind: 'suite_health',
        description: `Suite health report (${input.runs ?? 3} runs)`,
        params: {
          repoId: input.repoId ?? null,
          runs: input.runs ?? null,
        },
      },
      budget: DEFAULT_BUDGET,
      policy: DEFAULT_POLICY,
      successGate: { verifier: 'steward', criteria: ['health report generated'] },
      eventInput: input,
    });

    return reply.code(202).send(submitted);
  });
}
