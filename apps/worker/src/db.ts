import pg from 'pg';
import type { WorkerConfig } from './config.js';

const { Pool } = pg;

export function createPool(config: WorkerConfig): pg.Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: Math.max(4, config.concurrency * 2),
  });
}

export interface Tenant {
  orgId: string;
  workspaceId: string;
}

/** Sets tenant context for this transaction (workspaceId + orgId). */
export async function withTenant<T>(
  pool: pg.Pool,
  ctx: Tenant,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.org_id', $1, true)`, [ctx.orgId]);
    await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [ctx.workspaceId]);
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

/** System-context transaction — used for admin ops (rare). */
export async function withSystem<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.system_context', 'true', true)`);
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
