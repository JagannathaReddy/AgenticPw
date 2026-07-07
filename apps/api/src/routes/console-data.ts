import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';
import { runDoctorChecks } from '../doctor-checks.js';
import { renderUnifiedDiffPlain } from '../unified-diff.js';
import { resolveArtifactsDir } from '../repo-root.js';

/**
 * Data endpoints the web console needs beyond the existing CLI-facing
 * routes (Sprint: AgenticPw Console). Read-only except /apply, which
 * mirrors the worker's rung-2 semantics: copy the verified patch onto the
 * originals and record the implicit thumbs-up.
 */

const ARTIFACTS_ROOT = resolveArtifactsDir();

/** Resolve an artifact path, refusing anything that escapes the manifest dir. */
function safeArtifactPath(manifestId: string, name: string): string | null {
  const base = path.join(ARTIFACTS_ROOT, manifestId);
  const resolved = path.resolve(base, name);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

async function walkArtifacts(dir: string, prefix = ''): Promise<Array<{ name: string; size: number }>> {
  const out: Array<{ name: string; size: number }> = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walkArtifacts(path.join(dir, e.name), rel)));
    else {
      const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
      out.push({ name: rel, size: st?.size ?? 0 });
    }
  }
  return out;
}

export function registerConsoleDataRoutes(app: FastifyInstance, db: Db): void {
  // Spend summary for the topbar + dashboard sparkline (per-day buckets).
  app.get<{ Querystring: { sinceHours?: string; repoId?: string } }>(
    '/v1/costs',
    async (request) => {
      const sinceHours = Math.min(720, Math.max(1, Number(request.query.sinceHours ?? 168) || 168));
      const repoId = request.query.repoId ?? null;

      return withTenant(db, request.tenant, async (client) => {
        const repoFilter = repoId
          ? `AND manifest_id IN (
               SELECT id FROM manifests
                WHERE (goal->'params'->>'repoId')::uuid = $2
             )`
          : '';
        const params: unknown[] = [`${sinceHours} hours`];
        if (repoId) params.push(repoId);

        const { rows } = await client.query<{ day: string; usd: string }>(
          `SELECT date_trunc('day', ts)::date::text AS day, SUM(cost_usd) AS usd
             FROM llm_calls
            WHERE ts > (now() - $1::interval) ${repoFilter}
            GROUP BY 1 ORDER BY 1`,
          params,
        );
        const periodTotal = rows.reduce((s, r) => s + Number(r.usd), 0);
        const { rows: mrows } = await client.query<{ usd: string | null }>(
          `SELECT SUM(cost_usd) AS usd FROM llm_calls WHERE ts > now() - interval '30 days'`,
        );
        return {
          weekUSD: periodTotal,
          monthUSD: Number(mrows[0]?.usd ?? 0),
          sinceHours,
          days: rows.map((r) => ({ day: r.day, usd: Number(r.usd) })),
        };
      });
    },
  );

  // Detailed cost breakdown — mirrors `agent cost --since`.
  app.get<{ Querystring: { sinceHours?: string; repoId?: string } }>(
    '/v1/costs/breakdown',
    async (request) => {
      const sinceHours = Math.min(720, Math.max(1, Number(request.query.sinceHours ?? 24) || 24));
      const repoId = request.query.repoId ?? null;

      return withTenant(db, request.tenant, async (client) => {
        const repoFilter = repoId
          ? `AND manifest_id IN (
               SELECT id FROM manifests
                WHERE (goal->'params'->>'repoId')::uuid = $2
             )`
          : '';
        const params: unknown[] = [`${sinceHours} hours`];
        if (repoId) params.push(repoId);

        const { rows } = await client.query<{
          provider: string;
          model: string;
          prompt_id: string;
          manifest_id: string;
          tokens_in: number;
          tokens_out: number;
          cost_usd: string;
          latency_ms: number;
        }>(
          `SELECT provider, model, prompt_id, manifest_id,
                  tokens_in, tokens_out, cost_usd::text, latency_ms
             FROM llm_calls
            WHERE ts > (now() - $1::interval) ${repoFilter}
            ORDER BY ts`,
          params,
        );

        let totalCost = 0;
        let totalIn = 0;
        let totalOut = 0;
        const byRole = new Map<string, { count: number; cost: number; tokensIn: number; tokensOut: number }>();
        const byModel = new Map<string, { count: number; cost: number }>();
        const byManifest = new Map<string, { count: number; cost: number; role: string }>();

        for (const r of rows) {
          const cost = Number(r.cost_usd);
          totalCost += cost;
          totalIn += r.tokens_in;
          totalOut += r.tokens_out;
          const role = r.prompt_id.split('.')[0];
          const rd = byRole.get(role) ?? { count: 0, cost: 0, tokensIn: 0, tokensOut: 0 };
          byRole.set(role, {
            count: rd.count + 1,
            cost: rd.cost + cost,
            tokensIn: rd.tokensIn + r.tokens_in,
            tokensOut: rd.tokensOut + r.tokens_out,
          });
          const modelKey = `${r.provider}/${r.model}`;
          const md = byModel.get(modelKey) ?? { count: 0, cost: 0 };
          byModel.set(modelKey, { count: md.count + 1, cost: md.cost + cost });
          const manRec = byManifest.get(r.manifest_id) ?? { count: 0, cost: 0, role };
          byManifest.set(r.manifest_id, { count: manRec.count + 1, cost: manRec.cost + cost, role });
        }

        const topManifests = [...byManifest.entries()]
          .sort((a, b) => b[1].cost - a[1].cost)
          .slice(0, 5)
          .map(([id, r]) => ({ id, role: r.role, cost: r.cost, calls: r.count }));

        return {
          sinceHours,
          totalCost,
          callCount: rows.length,
          tokensIn: totalIn,
          tokensOut: totalOut,
          byRole: [...byRole.entries()]
            .map(([role, r]) => ({ role, ...r }))
            .sort((a, b) => b.cost - a.cost),
          byModel: [...byModel.entries()]
            .map(([model, r]) => ({ model, ...r }))
            .sort((a, b) => b.cost - a.cost),
          topManifests,
        };
      });
    },
  );

  // Full doctor check — mirrors `agent doctor`.
  app.get('/v1/doctor', async () => {
    const apiBase = process.env.TEST_AGENT_API ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
    const checks = await runDoctorChecks(apiBase);
    return {
      ok: checks.every((c) => c.ok),
      checks,
    };
  });

  // Environment snapshot for the Settings page. Booleans and labels only —
  // never secret values.
  app.get('/v1/settings', async (request) => {
    const apiBase = process.env.TEST_AGENT_API ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
    const doctorChecks = await runDoctorChecks(apiBase);
    return withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM repositories`);
      return {
        workspace: 'dev-tenant',
        env: [
          { name: 'OPENAI_API_KEY', set: !!process.env.OPENAI_API_KEY },
          { name: 'ANTHROPIC_API_KEY', set: !!process.env.ANTHROPIC_API_KEY },
          { name: 'LLM_MODEL', set: !!process.env.LLM_MODEL, value: process.env.LLM_MODEL ?? '(auto)' },
          { name: 'PLAYWRIGHT_PROJECT', set: !!process.env.PLAYWRIGHT_PROJECT, value: process.env.PLAYWRIGHT_PROJECT ?? '(default)' },
        ],
        checks: doctorChecks.map((c) => ({
          label: c.name,
          ok: c.ok,
          detail: c.detail,
          fixHint: c.fixHint,
        })),
        repoCount: Number(rows[0]?.n ?? 0),
      };
    });
  });

  // Per-manifest LLM ledger for the detail page.
  app.get<{ Params: { id: string } }>('/v1/tests/:id/llm-calls', async (request) => {
    return withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query(
        `SELECT task_class AS role, model, tokens_in AS "inTok", tokens_out AS "outTok",
                cost_usd::float AS cost, latency_ms AS "latencyMs", outcome, ts
           FROM llm_calls WHERE manifest_id = $1 ORDER BY ts`,
        [request.params.id],
      );
      return rows;
    });
  });

  // Artifact listing + file read for the detail page. Text files only.
  app.get<{ Params: { id: string } }>('/v1/tests/:id/artifacts', async (request) => {
    return walkArtifacts(path.join(ARTIFACTS_ROOT, request.params.id));
  });

  app.get<{ Params: { id: string }; Querystring: { name?: string } }>(
    '/v1/tests/:id/artifacts/file',
    async (request, reply) => {
      const name = request.query.name ?? '';
      const p = safeArtifactPath(request.params.id, name);
      if (!p) return reply.code(400).send({ error: 'invalid artifact path' });
      try {
        const content = await fs.readFile(p, 'utf8');
        return reply.type('text/plain').send(content.slice(0, 200_000));
      } catch {
        return reply.code(404).send({ error: 'artifact not found' });
      }
    },
  );

  // Unified diff (patched vs original) for the detail page. Server-side —
  // both files live on this machine.
  app.get<{ Params: { id: string } }>('/v1/tests/:id/diff', async (request, reply) => {
    const m = await withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query<{ result: Record<string, unknown> | null; role: string }>(
        `SELECT result, role FROM manifests WHERE id = $1`,
        [request.params.id],
      );
      return rows[0] ?? null;
    });
    if (!m) return reply.code(404).send({ error: 'manifest not found' });
    const r = m.result ?? {};
    const pairs: Array<{ original: string; patched: string }> = [];
    if (typeof r.originalTestPath === 'string' && typeof r.patchedTestPath === 'string') {
      pairs.push({ original: r.originalTestPath, patched: r.patchedTestPath });
      if (typeof r.patchedPageObjectPath === 'string') {
        const original = path.join(
          path.dirname(r.originalTestPath),
          'pages',
          path.basename(r.patchedPageObjectPath),
        );
        pairs.push({ original, patched: r.patchedPageObjectPath });
      }
    }
    for (const f of (r.files as Array<{ originalTestPath: string; patchedTestPath: string }> | undefined) ?? []) {
      if (f.patchedTestPath) pairs.push({ original: f.originalTestPath, patched: f.patchedTestPath });
    }
    const diffs: Array<{ file: string; diff: string }> = [];
    for (const pair of pairs) {
      const [orig, patched] = await Promise.all([
        fs.readFile(pair.original, 'utf8').catch(() => null),
        fs.readFile(pair.patched, 'utf8').catch(() => null),
      ]);
      if (orig === null || patched === null || orig === patched) continue;
      diffs.push({
        file: pair.original,
        diff: renderUnifiedDiffPlain(orig, patched, { aLabel: pair.original, bLabel: pair.patched, contextLines: 3 }),
      });
    }
    return diffs;
  });

  // Apply a verified patch from the console — same semantics as `agent
  // apply` / rung-2: copy patched onto originals, record implicit 👍.
  app.post<{ Params: { id: string } }>('/v1/tests/:id/apply', async (request, reply) => {
    const id = request.params.id;
    const m = await withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query<{
        role: string;
        status: string;
        result: Record<string, unknown> | null;
        repo_id: string | null;
      }>(
        `SELECT role, status, result, (goal->'params'->>'repoId')::uuid AS repo_id
           FROM manifests WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
    if (!m) return reply.code(404).send({ error: 'manifest not found' });
    if (m.status !== 'succeeded') {
      return reply.code(422).send({ error: `manifest is ${m.status}; only succeeded manifests apply` });
    }
    const r = m.result ?? {};

    const copies: Array<{ from: string; to: string }> = [];
    if (typeof r.patchedTestPath === 'string' && typeof r.originalTestPath === 'string') {
      copies.push({ from: r.patchedTestPath, to: r.originalTestPath });
      if (typeof r.patchedPageObjectPath === 'string') {
        copies.push({
          from: r.patchedPageObjectPath,
          to: path.join(path.dirname(r.originalTestPath), 'pages', path.basename(r.patchedPageObjectPath)),
        });
      }
    }
    for (const f of (r.files as Array<{ originalTestPath: string; patchedTestPath: string }> | undefined) ?? []) {
      if (f.patchedTestPath) copies.push({ from: f.patchedTestPath, to: f.originalTestPath });
    }
    if (copies.length === 0) {
      return reply.code(422).send({ error: 'nothing to apply (alreadyPassing or no patch)' });
    }
    const applied: string[] = [];
    for (const c of copies) {
      try {
        await fs.copyFile(c.from, c.to);
        applied.push(c.to);
      } catch {
        /* individual copy failure reported via applied list */
      }
    }
    if (applied.length > 0 && (m.role === 'triage' || m.role === 'quarantiner')) {
      await withTenant(db, request.tenant, async (client) => {
        await client.query(
          `INSERT INTO heal_feedback (workspace_id, repo_id, manifest_id, verdict, source, category, test_path)
           VALUES ($1, $2, $3, 'up', 'apply', $4, $5)
           ON CONFLICT (manifest_id) WHERE source = 'apply' DO NOTHING`,
          [
            request.tenant.workspaceId,
            m.repo_id,
            id,
            (r.category as string | undefined) ?? null,
            (r.originalTestPath as string | undefined) ?? null,
          ],
        );
      });
    }
    return { applied };
  });

  // Steward health report — JSON + markdown from artifacts, or rejection reason.
  app.get<{ Params: { id: string } }>('/v1/tests/:id/steward-report', async (request, reply) => {
    const id = request.params.id;
    const m = await withTenant(db, request.tenant, async (client) => {
      const { rows } = await client.query<{ role: string; status: string; result: Record<string, unknown> | null }>(
        `SELECT role, status, result FROM manifests WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
    if (!m) return reply.code(404).send({ error: 'manifest not found' });
    if (m.role !== 'steward') {
      return reply.code(422).send({ error: 'not a steward manifest' });
    }
    if (m.status === 'rejected' || m.status === 'failed' || m.status === 'cancelled') {
      const result = m.result ?? {};
      return {
        status: 'rejected' as const,
        reason: typeof result.reason === 'string' ? result.reason : 'Steward run rejected',
        category: typeof result.category === 'string' ? result.category : null,
      };
    }
    const base = path.join(ARTIFACTS_ROOT, id);
    try {
      const [reportRaw, markdown] = await Promise.all([
        fs.readFile(path.join(base, 'steward-report.json'), 'utf8'),
        fs.readFile(path.join(base, 'steward-report.md'), 'utf8').catch(() => null),
      ]);
      const report = JSON.parse(reportRaw) as Record<string, unknown>;
      const tests = (report.tests as Array<Record<string, unknown>> | undefined) ?? [];
      const failing = tests.filter(
        (t) => t.verdict === 'always_failing' || t.verdict === 'flaky',
      );
      return {
        status: 'succeeded' as const,
        report,
        markdown,
        failing,
        summary: {
          runs: report.runs,
          totalTests: report.totalTests,
          healthy: report.healthy,
          flaky: report.flaky,
          alwaysFailing: report.alwaysFailing,
          skipped: report.skipped,
        },
      };
    } catch {
      return reply.code(404).send({ error: 'steward report artifacts not found' });
    }
  });
}
