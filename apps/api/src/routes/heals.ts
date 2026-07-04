import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { submitManifest } from '../submit-manifest.js';

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

    const submitted = await submitManifest(db, request.tenant, request.userId, {
      role: 'triage',
      goal: {
        kind: 'heal_test',
        description: `Triage failing test ${input.testPath}`,
        params: {
          testPath: input.testPath,
          pageObjectPath: input.pageObjectPath ?? null,
          repoId: input.repoId ?? null,
          includeGlobs: input.includeGlobs ?? null,
        },
      },
      budget: DEFAULT_BUDGET,
      policy: DEFAULT_POLICY,
      successGate: { verifier: 'judge', criteria: ['patched test passes'] },
      eventInput: input,
    });

    return reply.code(202).send(submitted);
  });
}
