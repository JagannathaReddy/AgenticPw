import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ManifestBudget,
  ManifestPolicy,
  TaskManifest,
} from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';
import { submitManifest } from '../submit-manifest.js';

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

    const submitted = await submitManifest(db, request.tenant, request.userId, {
      role: 'coverage',
      goal: {
        kind: 'add_test',
        description: input.goal,
        params: {
          targetUrl: input.targetUrl,
          expectedOutcomes: input.expectedOutcomes,
          repoId: input.repoId ?? null,
          maxSteps: input.maxSteps ?? DEFAULT_BUDGET.maxSteps,
        },
      },
      budget: DEFAULT_BUDGET,
      policy: DEFAULT_POLICY,
      successGate: { verifier: 'judge', criteria: input.expectedOutcomes },
      eventInput: input,
    });

    return reply.code(202).send(submitted);
  });

  app.get<{ Params: { id: string } }>('/v1/tests/:id/events', async (request, reply) => {
    const id = request.params.id;

    // SSE headers. Fastify's reply.raw is Node's http.ServerResponse.
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // nginx pass-through
    reply.raw.flushHeaders?.();

    function send(event: string, data: unknown): void {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    let closed = false;
    request.raw.on('close', () => {
      closed = true;
    });

    // Poll manifest_events for new rows since `lastId`. Also emit a
    // terminal status event when the manifest reaches a terminal state.
    let lastId = 0;
    const startedAt = Date.now();
    const MAX_MS = 15 * 60_000;

    while (!closed && Date.now() - startedAt < MAX_MS) {
      let terminalStatus: string | null = null;
      let terminalResult: unknown = null;
      try {
        await withTenant(db, request.tenant, async (client) => {
          const { rows } = await client.query<{
            id: number;
            ts: string;
            kind: string;
            payload: unknown;
          }>(
            `SELECT id, ts, kind, payload
               FROM manifest_events
              WHERE manifest_id = $1 AND id > $2
              ORDER BY id
              LIMIT 500`,
            [id, lastId],
          );
          for (const row of rows) {
            send('manifest_event', row);
            lastId = row.id;
          }

          const { rows: mrows } = await client.query<{
            status: string;
            result: unknown;
          }>(`SELECT status, result FROM manifests WHERE id = $1`, [id]);
          if (mrows.length > 0) {
            const s = mrows[0].status;
            if (['succeeded', 'failed', 'rejected', 'cancelled'].includes(s)) {
              terminalStatus = s;
              terminalResult = mrows[0].result;
            }
          }
        });
      } catch (err) {
        send('error', { message: (err as Error).message });
      }

      if (terminalStatus) {
        send('terminal', { status: terminalStatus, result: terminalResult });
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!closed) reply.raw.end();
    return reply;
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
