import type pg from 'pg';
import { withTenant, type Tenant } from '../../db.js';

export async function sumManifestSpendUSD(
  pool: pg.Pool,
  tenant: Tenant,
  manifestIds: string[],
): Promise<number> {
  if (manifestIds.length === 0) return 0;
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{ total: string | null }>(
      `SELECT SUM(cost_usd) AS total FROM llm_calls WHERE manifest_id = ANY($1::uuid[])`,
      [manifestIds],
    );
    return Number(rows[0]?.total ?? 0);
  });
}

export async function enforceAssignmentBudget(
  pool: pg.Pool,
  tenant: Tenant,
  parentManifestId: string,
  childIds: string[],
  maxCostUSD: number,
): Promise<{ ok: true; spent: number } | { ok: false; spent: number }> {
  const spent = await sumManifestSpendUSD(pool, tenant, [parentManifestId, ...childIds]);
  if (spent >= maxCostUSD) return { ok: false, spent };
  return { ok: true, spent };
}
