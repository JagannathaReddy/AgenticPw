import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';
import { insertManifestRows } from '../submit-manifest.js';

const registerSchema = z.object({
  name: z.string().min(1),
  localPath: z.string().min(1),
});

const onboardSchema = z
  .object({
    maxSteps: z.number().int().positive().optional(),
  })
  .optional();

const DEFAULT_BUDGET: ManifestBudget = {
  maxTokens: 10_000,
  maxSteps: 1,
  maxDurationSec: 300,
  maxCostUSD: 1,
};

const DEFAULT_POLICY: ManifestPolicy = {
  trustRung: 1,
  canWritePR: false,
  canFileIssue: true,
  refuseCategories: [],
  escalationSLA: 300,
};

export function registerReposRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/repos', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { name, localPath } = parsed.data;
    const abs = path.resolve(localPath);

    return withTenant(db, request.tenant, async (client) => {
      // Upsert on (workspace_id, local_path) so re-registering is idempotent.
      const { rows } = await client.query<{ id: string; status: string }>(
        `INSERT INTO repositories (workspace_id, full_name, local_path, status)
         VALUES ($1, $2, $3, 'onboarding')
         ON CONFLICT (workspace_id, local_path) WHERE local_path IS NOT NULL
         DO UPDATE SET updated_at = now()
         RETURNING id, status`,
        [request.tenant.workspaceId, name, abs],
      );
      const row = rows[0];
      return reply.code(201).send({
        repoId: row.id,
        name,
        localPath: abs,
        status: row.status,
      });
    });
  });

  app.get('/v1/repos', async (request) => {
    return withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query(
        `SELECT r.id, r.full_name AS name, r.local_path AS "localPath",
                r.status, r.profile_id AS "profileId",
                r.onboarded_at AS "onboardedAt", r.created_at AS "createdAt"
         FROM repositories r
         ORDER BY r.created_at DESC LIMIT 50`,
      );
      return rows;
    });
  });

  app.get<{ Params: { id: string } }>('/v1/repos/:id', async (request, reply) => {
    return withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query(
        `SELECT r.id, r.full_name AS name, r.local_path AS "localPath",
                r.status, r.profile_id AS "profileId",
                r.onboarded_at AS "onboardedAt", r.created_at AS "createdAt",
                p.conventions AS profile,
                p.confidence,
                p.extractor_version AS "extractorVersion",
                p.extracted_at AS "extractedAt"
         FROM repositories r
         LEFT JOIN repo_profiles p ON p.id = r.profile_id
         WHERE r.id = $1`,
        [request.params.id],
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'repo not found' });
      return rows[0];
    });
  });

  app.post<{ Params: { id: string } }>(
    '/v1/repos/:id/onboard',
    async (request, reply) => {
      const parsed = onboardSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const repoId = request.params.id;

      return withTenant(db, request.tenant, async (client) => {
        const { rows } = await client.query<{ local_path: string | null }>(
          `SELECT local_path FROM repositories WHERE id = $1`,
          [repoId],
        );
        if (rows.length === 0) return reply.code(404).send({ error: 'repo not found' });
        const localPath = rows[0].local_path;
        if (!localPath) {
          return reply
            .code(400)
            .send({ error: 'repo has no local_path — cannot onboard from filesystem' });
        }

        const submitted = await insertManifestRows(client, request.tenant, request.userId, {
          role: 'onboarding',
          goal: {
            kind: 'onboard_repo',
            description: `Extract RepoProfile from ${localPath}`,
            params: { repoId, localPath },
          },
          budget: DEFAULT_BUDGET,
          policy: DEFAULT_POLICY,
          successGate: { verifier: 'reviewer', criteria: ['profile parses'] },
          eventInput: { repoId, localPath },
        });

        return reply.code(202).send({
          ...submitted,
          repoId,
          status: 'pending',
        });
      });
    },
  );
}
