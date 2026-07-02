#!/usr/bin/env tsx
/**
 * Seed a single dev tenant. Idempotent — safe to run any number of times.
 *
 * Reads:
 *   DATABASE_URL         (default postgres://platform:platform@127.0.0.1:5432/platform)
 *   DEV_ORG_ID           (default 00000000-0000-0000-0000-000000000000)
 *   DEV_WORKSPACE_ID     (default 00000000-0000-0000-0000-000000000001)
 *   DEV_USER_ID          (default user_dev)
 */
import pg from 'pg';

const url =
  process.env.DATABASE_URL ??
  'postgres://platform:platform@127.0.0.1:5432/platform';
const ORG_ID = process.env.DEV_ORG_ID ?? '00000000-0000-0000-0000-000000000000';
const WORKSPACE_ID =
  process.env.DEV_WORKSPACE_ID ?? '00000000-0000-0000-0000-000000000001';
const USER_ID = process.env.DEV_USER_ID ?? 'user_dev';

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.system_context = 'true'`);

    await client.query(
      `INSERT INTO organizations (id, name, plan, status)
         VALUES ($1, 'Dev Org', 'design_partner', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [ORG_ID],
    );

    await client.query(
      `INSERT INTO workspaces (id, org_id, name, status, trust_rung)
         VALUES ($1, $2, 'dev', 'active', 1)
       ON CONFLICT (id) DO NOTHING`,
      [WORKSPACE_ID, ORG_ID],
    );

    await client.query(
      `INSERT INTO org_members (org_id, user_id, email, role)
         VALUES ($1, $2, 'dev@localhost', 'owner')
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [ORG_ID, USER_ID],
    );

    await client.query(
      `INSERT INTO budgets (workspace_id, daily_usd, monthly_usd)
         VALUES ($1, 50, 500)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [WORKSPACE_ID],
    );

    await client.query('COMMIT');
    console.log('✓ Dev tenant ready.');
    console.log(`  org      : ${ORG_ID}`);
    console.log(`  workspace: ${WORKSPACE_ID}`);
    console.log(`  user     : ${USER_ID}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
