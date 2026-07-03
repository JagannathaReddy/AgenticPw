#!/usr/bin/env tsx
/**
 * agent cost — query llm_calls, aggregate, print.
 *
 * The prompt-hash for every call maps back to a role via the prompt id
 * (see the front-matter in prompts/{role}/system.md). We group by that id
 * so the user sees explorer / generator / healer / judge / classifier /
 * onboarding breakdowns.
 */
import pg from 'pg';

const { Pool } = pg;

interface CostArgs {
  sinceHours: number;
  repoRef?: string;
  workspaceId: string;
  orgId: string;
  databaseUrl: string;
}

function parseArgs(argv: string[]): CostArgs {
  let sinceHours = 24;
  let repoRef: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') {
      const v = argv[++i] ?? '';
      const m = v.match(/^(\d+)\s*([hd])?$/);
      if (m) {
        const n = Number(m[1]);
        sinceHours = m[2] === 'd' ? n * 24 : n;
      }
    } else if (a === '--repo') {
      repoRef = argv[++i];
    } else if (a === '--help' || a === '-h') {
      process.stderr.write(
        `Usage: test-agent cost [--since 24h|7d] [--repo <shortId|uuid>]\n`,
      );
      process.exit(0);
    }
  }
  return {
    sinceHours,
    repoRef,
    workspaceId: process.env.DEV_WORKSPACE_ID ?? '00000000-0000-0000-0000-000000000001',
    orgId: process.env.DEV_ORG_ID ?? '00000000-0000-0000-0000-000000000000',
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgres://platform:platform@127.0.0.1:5433/platform',
  };
}

function roleFromPromptId(promptId: string): string {
  // classifier.fallback.v1 → classifier
  // generator.system.v1 → generator
  // etc.
  return promptId.split('.')[0];
}

async function withTenant<T>(
  pool: pg.Pool,
  workspaceId: string,
  orgId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
    await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [workspaceId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export async function runCost(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const pool = new Pool({ connectionString: args.databaseUrl });

  try {
    const rows = await withTenant(pool, args.workspaceId, args.orgId, async (client) => {
      const { rows } = await client.query<{
        provider: string;
        model: string;
        prompt_id: string;
        manifest_id: string;
        tokens_in: number;
        tokens_out: number;
        cost_usd: string;
        latency_ms: number;
        ts: string;
      }>(
        `SELECT provider, model, prompt_id, manifest_id,
                tokens_in, tokens_out, cost_usd::text, latency_ms, ts
           FROM llm_calls
          WHERE ts > (now() - $1::interval)
          ORDER BY ts`,
        [`${args.sinceHours} hours`],
      );
      return rows;
    });

    if (rows.length === 0) {
      process.stdout.write(`No LLM calls in the last ${args.sinceHours} h.\n`);
      return 0;
    }

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

      const role = roleFromPromptId(r.prompt_id);
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
      byManifest.set(r.manifest_id, {
        count: manRec.count + 1,
        cost: manRec.cost + cost,
        role: manRec.role,
      });
    }

    const window = args.sinceHours >= 24 && args.sinceHours % 24 === 0
      ? `${args.sinceHours / 24}d`
      : `${args.sinceHours}h`;

    process.stdout.write(`Last ${window}:  ${fmtUsd(totalCost)}  (${rows.length} calls, ${fmt(totalIn)} in + ${fmt(totalOut)} out tokens)\n`);
    process.stdout.write('\n');

    process.stdout.write('By role:\n');
    const sortedRoles = [...byRole.entries()].sort((a, b) => b[1].cost - a[1].cost);
    for (const [role, r] of sortedRoles) {
      process.stdout.write(`  ${role.padEnd(12)}  ${fmtUsd(r.cost)}   ${String(r.count).padStart(4)} calls   ${fmt(r.tokensIn + r.tokensOut)} tokens\n`);
    }
    process.stdout.write('\n');

    process.stdout.write('By model:\n');
    const sortedModels = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
    for (const [model, r] of sortedModels) {
      process.stdout.write(`  ${model.padEnd(28)}  ${fmtUsd(r.cost)}   ${String(r.count).padStart(4)} calls\n`);
    }
    process.stdout.write('\n');

    const topManifests = [...byManifest.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .slice(0, 5);
    if (topManifests.length > 0) {
      process.stdout.write('Top-spend manifests:\n');
      for (const [id, r] of topManifests) {
        process.stdout.write(`  ${id.slice(0, 8)}   ${r.role.padEnd(12)}  ${fmtUsd(r.cost)}   ${r.count} calls\n`);
      }
    }

    return 0;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCost(process.argv.slice(2)).then((code) => process.exit(code));
}
