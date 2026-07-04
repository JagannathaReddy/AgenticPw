import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { submitManifest } from '../submit-manifest.js';

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

    const submitted = await submitManifest(db, request.tenant, request.userId, {
      role: 'improver',
      goal: {
        kind: 'improve_test',
        description: `Improve existing spec ${input.testPath}`,
        params: {
          testPath: input.testPath,
          pageObjectPath: input.pageObjectPath ?? null,
          repoId: input.repoId ?? null,
        },
      },
      budget: DEFAULT_BUDGET,
      policy: DEFAULT_POLICY,
      successGate: { verifier: 'judge', criteria: ['improved test still passes'] },
      eventInput: input,
    });

    return reply.code(202).send(submitted);
  });
}
