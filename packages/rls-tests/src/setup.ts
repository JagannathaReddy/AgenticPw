import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

/**
 * Test tenants — synthetic org + workspace pair.
 * A and B are used to prove isolation; the S context asserts system access.
 */
export interface TestTenant {
  orgId: string;
  workspaceId: string;
  repoId: string;
  manifestId: string;
}

export interface TestFixture {
  a: TestTenant;
  b: TestTenant;
  /** Pool of connections, one per test to keep session vars isolated. */
  connect: () => Promise<pg.Client>;
  cleanup: () => Promise<void>;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set for RLS tests`);
  return v;
}

/**
 * Connect as the migrator (superuser) — used only for fixture setup which
 * needs to bypass RLS to seed cross-tenant data.
 */
export async function connectSuper(): Promise<pg.Client> {
  const url = requireEnv('DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/**
 * Connect and immediately `SET ROLE app_user` so RLS is enforced for the
 * remainder of the session. This is the connection every RLS assertion runs
 * against.
 */
export async function connectAsAppUser(): Promise<pg.Client> {
  const client = await connectSuper();
  await client.query('SET ROLE app_user');
  return client;
}

export async function setTenantContext(
  client: pg.Client,
  ctx: { orgId?: string; workspaceId?: string; system?: boolean },
): Promise<void> {
  await client.query('BEGIN');
  if (ctx.orgId) await client.query(`SELECT set_config('app.org_id', $1, true)`, [ctx.orgId]);
  if (ctx.workspaceId) await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [ctx.workspaceId]);
  if (ctx.system) await client.query(`SELECT set_config('app.system_context', 'true', true)`);
}

export async function clearTenantContext(client: pg.Client): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined);
}

async function createTenant(client: pg.Client, name: string): Promise<TestTenant> {
  const orgId = randomUUID();
  const workspaceId = randomUUID();
  const repoId = randomUUID();
  const manifestId = randomUUID();

  await client.query(`SELECT set_config('app.system_context', 'true', true)`);

  await client.query(
    `INSERT INTO organizations (id, name, plan) VALUES ($1, $2, 'design_partner')`,
    [orgId, `rls-org-${name}`],
  );
  await client.query(
    `INSERT INTO workspaces (id, org_id, name, status) VALUES ($1, $2, $3, 'active')`,
    [workspaceId, orgId, `rls-ws-${name}`],
  );
  await client.query(
    `INSERT INTO repositories (id, workspace_id, full_name, github_repo_id, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [repoId, workspaceId, `rls/${name}`, Math.floor(Math.random() * 1_000_000)],
  );
  await client.query(
    `INSERT INTO manifests
       (id, org_id, workspace_id, role, status, workflow_id, goal, context, budget, success_gate, policy, audit)
     VALUES ($1, $2, $3, 'coverage', 'pending', $4, $5, '{}', $6, $7, $8, $9)`,
    [
      manifestId,
      orgId,
      workspaceId,
      `wf-${randomUUID()}`,
      JSON.stringify({ kind: 'add_test', description: `rls-${name}`, params: {} }),
      JSON.stringify({ maxTokens: 1000, maxSteps: 10, maxDurationSec: 900, maxCostUSD: 5 }),
      JSON.stringify({ verifier: 'judge', criteria: ['passes'] }),
      JSON.stringify({
        trustRung: 1,
        canWritePR: false,
        canFileIssue: true,
        refuseCategories: [],
        escalationSLA: 600,
      }),
      JSON.stringify({ correlationId: randomUUID() }),
    ],
  );

  return { orgId, workspaceId, repoId, manifestId };
}

/**
 * Build a fresh pair of tenants A and B. Assumes migrations already applied.
 * Uses a superuser connection for seed since RLS would otherwise block the
 * cross-tenant inserts.
 */
export async function buildFixture(): Promise<TestFixture> {
  const setup = await connectSuper();
  await setup.query('BEGIN');
  const a = await createTenant(setup, 'A');
  const b = await createTenant(setup, 'B');
  await setup.query('COMMIT');
  await setup.end();

  const opened: pg.Client[] = [];
  return {
    a,
    b,
    async connect() {
      const c = await connectAsAppUser();
      opened.push(c);
      return c;
    },
    async cleanup() {
      for (const c of opened) await c.end().catch(() => undefined);
      const c = await connectSuper();
      // Delete in reverse FK dependency order — workspaces_org_id_fkey is
      // NO ACTION so we can't just DELETE FROM organizations directly.
      try {
        const orgIds = [a.orgId, b.orgId];
        await c.query(`DELETE FROM manifest_events WHERE workspace_id IN (SELECT id FROM workspaces WHERE org_id = ANY($1))`, [orgIds]);
        await c.query(`DELETE FROM manifests WHERE org_id = ANY($1)`, [orgIds]);
        await c.query(`DELETE FROM repo_profiles WHERE workspace_id IN (SELECT id FROM workspaces WHERE org_id = ANY($1))`, [orgIds]);
        await c.query(`DELETE FROM repositories WHERE workspace_id IN (SELECT id FROM workspaces WHERE org_id = ANY($1))`, [orgIds]);
        await c.query(`DELETE FROM workspaces WHERE org_id = ANY($1)`, [orgIds]);
        await c.query(`DELETE FROM organizations WHERE id = ANY($1)`, [orgIds]);
      } finally {
        await c.end();
      }
    },
  };
}
