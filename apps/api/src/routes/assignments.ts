import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';
import { resolveArtifactsDir } from '../repo-root.js';
import { createAssignment, createAssignmentSchema } from '../create-assignment.js';

function verifyWebhookSecret(request: { headers: Record<string, unknown> }): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true;
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth === `Bearer ${secret}`) return true;
  const header = request.headers['x-webhook-secret'];
  return typeof header === 'string' && header === secret;
}

export function registerWebhookRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/webhooks/assignments', async (request, reply) => {
    if (!verifyWebhookSecret(request)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const parsed = createAssignmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const input = {
      ...parsed.data,
      source: parsed.data.source ?? ('api' as const),
      skipIfActive: parsed.data.skipIfActive ?? true,
    };

    const result = await withTenant(db, request.tenant, async (client) =>
      createAssignment(client, request.tenant, request.userId, input),
    );

    if (!result.ok) {
      return reply.code(409).send({
        skipped: true,
        reason: result.reason,
        assignmentId: result.existingAssignmentId,
        manifestId: result.manifestId,
      });
    }

    return reply.code(202).send(result);
  });
}

export function registerAssignmentsRoutes(app: FastifyInstance, db: Db): void {
  app.post('/v1/assignments', async (request, reply) => {
    const parsed = createAssignmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const result = await withTenant(db, request.tenant, async (client) =>
      createAssignment(client, request.tenant, request.userId, parsed.data),
    );

    if (!result.ok) {
      return reply.code(409).send({
        skipped: true,
        reason: result.reason,
        assignmentId: result.existingAssignmentId,
        manifestId: result.manifestId,
      });
    }

    return reply.code(202).send(result);
  });

  app.get('/v1/assignments', async (request, reply) => {
    const query = request.query as { repoId?: string; status?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);

    const rows = await withTenant(db, request.tenant, async (client) => {
      const params: unknown[] = [request.tenant.workspaceId];
      let sql = `
        SELECT a.id, a.manifest_id, a.repo_id, a.assignment_type, a.title, a.status,
               a.source, a.loop_state, a.escalation, a.created_at, a.updated_at, a.completed_at,
               m.status AS manifest_status, m.result AS manifest_result
          FROM qa_assignments a
          JOIN manifests m ON m.id = a.manifest_id
         WHERE a.workspace_id = $1`;
      if (query.repoId) {
        params.push(query.repoId);
        sql += ` AND a.repo_id = $${params.length}`;
      }
      if (query.status) {
        params.push(query.status);
        sql += ` AND a.status = $${params.length}`;
      }
      params.push(limit);
      sql += ` ORDER BY a.created_at DESC LIMIT $${params.length}`;
      const { rows: r } = await client.query(sql, params);
      return r;
    });

    return reply.send(rows);
  });

  app.get('/v1/assignments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query(
        `SELECT a.*, m.status AS manifest_status, m.result AS manifest_result, m.role AS manifest_role
           FROM qa_assignments a
           JOIN manifests m ON m.id = a.manifest_id
          WHERE a.workspace_id = $1 AND (a.id = $2 OR a.manifest_id = $2)`,
        [request.tenant.workspaceId, id],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'Assignment not found' });
    return reply.send(row);
  });

  app.post('/v1/assignments/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = await withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query<{ manifest_id: string; status: string }>(
        `SELECT manifest_id, status FROM qa_assignments
          WHERE workspace_id = $1 AND (id = $2 OR manifest_id = $2)`,
        [request.tenant.workspaceId, id],
      );
      const row = rows[0];
      if (!row) return null;
      if (!['active', 'needs_you'].includes(row.status)) return { error: 'not_cancellable' as const };

      await client.query(
        `UPDATE qa_assignments SET status = 'cancelled', completed_at = now(), updated_at = now()
          WHERE manifest_id = $1`,
        [row.manifest_id],
      );
      await client.query(
        `UPDATE manifests SET status = 'cancelled', finished_at = now(), updated_at = now(),
                result = COALESCE(result, '{}'::jsonb) || '{"status":"cancelled","reason":"user"}'::jsonb
          WHERE id = $1 AND status IN ('pending','assigned','in_progress')`,
        [row.manifest_id],
      );
      return { manifestId: row.manifest_id, status: 'cancelled' };
    });

    if (!updated) return reply.code(404).send({ error: 'Assignment not found' });
    if ('error' in updated) return reply.code(409).send({ error: 'Assignment cannot be cancelled' });
    return reply.send(updated);
  });

  app.get('/v1/assignments/:id/report', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query<{ manifest_id: string }>(
        `SELECT manifest_id FROM qa_assignments
          WHERE workspace_id = $1 AND (id = $2 OR manifest_id = $2)`,
        [request.tenant.workspaceId, id],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'Assignment not found' });

    const reportPath = path.join(resolveArtifactsDir(), row.manifest_id, 'teammate-report.json');
    try {
      const raw = await fs.readFile(reportPath, 'utf8');
      return reply.send(JSON.parse(raw));
    } catch {
      return reply.code(404).send({ error: 'Teammate report not found yet' });
    }
  });
}
