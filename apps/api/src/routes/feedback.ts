import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';
import { resolveArtifactsDir } from '../repo-root.js';

const createFeedbackSchema = z.object({
  manifestId: z.string().uuid(),
  verdict: z.enum(['up', 'down']),
  source: z.enum(['explicit', 'apply']).default('explicit'),
  note: z.string().max(2000).optional(),
});

interface TriageManifestSnapshot {
  role: string;
  status: string;
  repo_id: string | null;
  test_path: string | null;
  category: string | null;
  prompt_id: string | null;
  prompt_hash: string | null;
  model: string | null;
}

export function registerFeedbackRoutes(app: FastifyInstance, db: Db): void {
  // Record a verdict on a heal. The row snapshots category / prompt / model
  // from the manifest and its healer llm_call so accept-rates stay queryable
  // per (category, prompt, model) after prompts change.
  app.post('/v1/feedback', async (request, reply) => {
    const parsed = createFeedbackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const input = parsed.data;

    const outcome = await withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query<TriageManifestSnapshot>(
        `SELECT m.role,
                m.status,
                (m.goal->'params'->>'repoId')::uuid AS repo_id,
                m.goal->'params'->>'testPath'       AS test_path,
                m.result->>'category'               AS category,
                lc.prompt_id, lc.prompt_hash, lc.model
           FROM manifests m
           LEFT JOIN LATERAL (
             SELECT prompt_id, prompt_hash, model
               FROM llm_calls
              WHERE manifest_id = m.id AND task_class = 'generate'
              ORDER BY ts DESC
              LIMIT 1
           ) lc ON true
          WHERE m.id = $1`,
        [input.manifestId],
      );
      if (rows.length === 0) return { code: 404 as const, error: 'Manifest not found' };
      const m = rows[0];
      if (m.role !== 'triage' && m.role !== 'quarantiner') {
        return {
          code: 422 as const,
          error: `Feedback targets heals/quarantines; manifest ${input.manifestId} has role '${m.role}'.`,
        };
      }

      // One implicit apply-vote per manifest (idempotent re-apply); explicit
      // rows are unlimited — a changed mind is a new row.
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO heal_feedback
           (workspace_id, repo_id, manifest_id, verdict, source,
            category, test_path, prompt_file, prompt_hash, model, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (manifest_id) WHERE source = 'apply' DO NOTHING
         RETURNING id`,
        [
          request.tenant.workspaceId,
          m.repo_id,
          input.manifestId,
          input.verdict,
          input.source,
          m.category,
          m.test_path,
          m.prompt_id,
          m.prompt_hash,
          m.model,
          input.note ?? null,
        ],
      );
      return {
        code: 201 as const,
        body: {
          id: inserted.rows[0]?.id ?? null,
          created: inserted.rows.length > 0,
          manifestId: input.manifestId,
          verdict: input.verdict,
          source: input.source,
          category: m.category,
        },
      };
    });

    if (outcome.code !== 201) return reply.code(outcome.code).send({ error: outcome.error });
    return reply.code(201).send(outcome.body);
  });

  // All feedback rows for one manifest — `agent feedback --promote` reads
  // the recorded verdict + note from here. Registered before /stats would
  // clash, so keep the literal route first.
  app.get<{ Params: { manifestId: string } }>(
    '/v1/feedback/manifest/:manifestId',
    async (request, reply) => {
      const rows = await withTenant(db, request.tenant, async (client) => {
        const { rows } = await client.query(
          `SELECT verdict, source, category, test_path, note, created_at
             FROM heal_feedback
            WHERE manifest_id = $1
            ORDER BY created_at DESC`,
          [request.params.manifestId],
        );
        return rows;
      });
      return reply.send(rows);
    },
  );

  // Aggregate accept-rates the eval harness and `agent feedback --stats` read.
  app.get('/v1/feedback/stats', async (request, reply) => {
    const stats = await withTenant(db, request.tenant, async (client) => {
      const byCategory = await client.query(
        `SELECT COALESCE(category, '(unclassified)') AS category,
                COUNT(*) FILTER (WHERE verdict = 'up')::int   AS ups,
                COUNT(*) FILTER (WHERE verdict = 'down')::int AS downs,
                COUNT(*)::int                                 AS total
           FROM heal_feedback
          GROUP BY 1
          ORDER BY total DESC`,
      );
      const byPrompt = await client.query(
        `SELECT COALESCE(prompt_hash, '(unknown)') AS prompt_hash,
                COALESCE(prompt_file, '(unknown)') AS prompt_file,
                COALESCE(model, '(unknown)')       AS model,
                COUNT(*) FILTER (WHERE verdict = 'up')::int   AS ups,
                COUNT(*) FILTER (WHERE verdict = 'down')::int AS downs,
                COUNT(*)::int                                 AS total
           FROM heal_feedback
          GROUP BY 1, 2, 3
          ORDER BY total DESC
          LIMIT 20`,
      );
      const recent = await client.query(
        `SELECT hf.manifest_id, hf.verdict, hf.source, hf.category, hf.test_path,
                hf.note, hf.created_at, m.role
           FROM heal_feedback hf
           LEFT JOIN manifests m ON m.id = hf.manifest_id
          ORDER BY hf.created_at DESC
          LIMIT 10`,
      );
      return {
        byCategory: byCategory.rows,
        byPrompt: byPrompt.rows,
        recent: recent.rows,
      };
    });
    return reply.send(stats);
  });

  const promoteSchema = z.object({ write: z.boolean().optional() });

  // Promote a rated heal into an eval triple draft — mirrors `agent feedback --promote`.
  app.post<{ Params: { manifestId: string } }>(
    '/v1/feedback/promote/:manifestId',
    async (request, reply) => {
      const parsed = promoteSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const write = parsed.data.write ?? false;
      const manifestId = request.params.manifestId;

      const manifest = await withTenant(db, request.tenant, async (client) => {
        const { rows } = await client.query<{ role: string; goal: { kind?: string } | null }>(
          `SELECT role, goal FROM manifests WHERE id = $1`,
          [manifestId],
        );
        return rows[0] ?? null;
      });
      if (!manifest) return reply.code(404).send({ error: 'manifest not found' });
      const role = manifest.role ?? '';
      if (!(role === 'triage' || manifest.goal?.kind === 'heal_test')) {
        return reply.code(422).send({
          error: `--promote works on heal manifests; ${manifestId.slice(0, 8)} is role=${role}.`,
        });
      }

      const feedbackRows = await withTenant(db, request.tenant, async (client) => {
        const { rows } = await client.query<{ verdict: 'up' | 'down'; source: string; note: string | null }>(
          `SELECT verdict, source, note FROM heal_feedback WHERE manifest_id = $1 ORDER BY created_at DESC`,
          [manifestId],
        );
        return rows;
      });
      if (feedbackRows.length === 0) {
        return reply.code(422).send({
          error: 'No feedback recorded — rate the manifest first (apply, or feedback --up/--down).',
        });
      }
      const row = feedbackRows.find((r) => r.source === 'explicit') ?? feedbackRows[0];

      const inputPath = path.join(resolveArtifactsDir(), manifestId, 'heal-input.json');
      let vars: Record<string, string>;
      try {
        vars = JSON.parse(await fs.readFile(inputPath, 'utf8')) as Record<string, string>;
      } catch {
        return reply.code(422).send({
          error: `${inputPath} not found — re-run the heal and promote that manifest.`,
        });
      }

      const short = manifestId.slice(0, 8);
      if (row.verdict === 'down' && row.note) {
        vars.prior_feedback = [
          '1 previous patch rejected by a human reviewer.',
          '',
          'Most instructive verdicts:',
          `- REJECTED ${vars.test_path} (${vars.failure_category}): "${row.note.replace(/"/g, "'")}"`,
          '',
          'REJECTED notes are corrections from a human who saw a previous patch fail in this repo. Treat them as constraints — do not repeat those mistakes.',
        ].join('\n');
      }

      const expected =
        row.verdict === 'up'
          ? { testFile: { mustContain: ['===FILE:'], mustNotContain: ['===REFUSE==='] } }
          : { testFile: { mustContain: ['===REFUSE==='], mustNotContain: ['===FILE:'] } };

      const triple = {
        id: `healer.promoted.${short}.v1`,
        role: 'healer',
        tags: ['feedback', 'promoted', `promoted-${row.verdict}`],
        difficulty: 'medium',
        input: { extraVariables: vars },
        expected,
        metrics: { costMaxUSD: 0.01, latencyMaxMs: 60000 },
      };

      const target = `prompts/eval/corpus/healer-promoted-${short}.json`;
      const body = JSON.stringify(triple, null, 2) + '\n';

      if (write) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, body);
      }

      return {
        verdict: row.verdict,
        target,
        triple,
        body,
        written: write,
      };
    },
  );
}
