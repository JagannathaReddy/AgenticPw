import pg from 'pg';
import type { ApiConfig } from './config.js';

const { Pool } = pg;

export type Db = pg.Pool;

export function createPool(config: ApiConfig): Db {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export interface TenantContext {
  orgId: string;
  workspaceId: string;
  systemContext?: boolean;
}

/**
 * Run a callback with tenant context set as Postgres session variables.
 * Every write path in the API must go through this — never talk to `pool`
 * directly for tenant-scoped work.
 */
export async function withTenant<T>(
  pool: Db,
  ctx: TenantContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Postgres does not allow bound parameters in SET; use set_config with
    // is_local=true (equivalent to SET LOCAL).
    if (ctx.systemContext) {
      await client.query(`SELECT set_config('app.system_context', 'true', true)`);
    } else {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [ctx.orgId]);
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [ctx.workspaceId]);
    }
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
