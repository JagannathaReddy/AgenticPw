import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';
import { submitManifest } from '../submit-manifest.js';

const createQuarantineSchema = z.object({
  fromManifestId: z.string().uuid(),
  repoId: z.string().uuid().optional(),
  autoApply: z.boolean().optional(),
});

// Deterministic workflow — the budget exists for shape consistency, not
// because anything here can spend money.
const DEFAULT_BUDGET: ManifestBudget = {
  maxTokens: 0,
  maxSteps: 25,
  maxDurationSec: 900,
  maxCostUSD: 0,
};

const DEFAULT_POLICY: ManifestPolicy = {
  trustRung: 1,
  canWritePR: false,
  canFileIssue: true,
  refuseCategories: ['unknown'],
  escalationSLA: 900,
};

export function registerQuarantinesRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/quarantines', async (request, reply) => {
    const parsed = createQuarantineSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const input = parsed.data;

    // Pull flaky targets (and the repo) from the steward manifest's result.
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
    const targets = (source.result?.flakyTests as Array<{ file: string; title: string }> | undefined) ?? null;
    if (targets === null) {
      return reply.code(422).send({
        error:
          'This steward report predates flaky targets (v0.9.0). Re-run `agent steward` and try again.',
      });
    }
    if (targets.length === 0) {
      return reply.code(422).send({
        error: 'Steward report has no flaky tests — nothing to quarantine.',
      });
    }
    const repoId = input.repoId ?? source.goal?.params?.repoId ?? null;

    const submitted = await submitManifest(db, request.tenant, request.userId, {
      role: 'quarantiner',
      goal: {
        kind: 'quarantine_flaky',
        description: `Quarantine ${targets.length} flaky test(s) from steward ${input.fromManifestId.slice(0, 8)}`,
        params: {
          repoId,
          stewardManifestId: input.fromManifestId,
          targets,
          autoApply: input.autoApply ?? false,
        },
      },
      budget: DEFAULT_BUDGET,
      policy: { ...DEFAULT_POLICY, trustRung: input.autoApply ? 2 : 1 },
      successGate: { verifier: 'judge', criteria: ['patched files run green'] },
      eventInput: { ...input, resolvedTargets: targets },
    });

    return reply.code(202).send({ ...submitted, targetCount: targets.length });
  });
}
