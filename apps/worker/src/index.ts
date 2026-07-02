import { loadConfig } from './config.js';
import { createPool, withSystem, withTenant } from './db.js';
import { LocalFsStore } from './artifacts.js';
import type { CoverageManifestRow } from './workflows/coverage.js';
import { runCoverage } from './workflows/coverage.js';

const RESET_STALE_ON_BOOT = process.env.WORKER_RESET_STALE !== 'false';

async function claimNext(pool: ReturnType<typeof createPool>): Promise<CoverageManifestRow | null> {
  return withSystem(pool, async (client) => {
    const { rows } = await client.query<CoverageManifestRow>(
      `WITH picked AS (
         SELECT id FROM manifests
          WHERE status = 'pending' AND role = 'coverage'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE manifests m
          SET status = 'assigned', updated_at = now()
         FROM picked
        WHERE m.id = picked.id
        RETURNING m.id, m.org_id, m.workspace_id, m.goal, m.audit`,
    );
    return rows[0] ?? null;
  });
}

async function resetStale(pool: ReturnType<typeof createPool>): Promise<number> {
  return withSystem(pool, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE manifests
          SET status = 'pending'
        WHERE status IN ('assigned', 'in_progress')`,
    );
    return rowCount ?? 0;
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  const artifacts = new LocalFsStore(config.artifactsDir);

  if (RESET_STALE_ON_BOOT) {
    const restored = await resetStale(pool);
    if (restored > 0) console.log(`[worker] Re-enqueued ${restored} stale manifest(s)`);
  }

  console.log(`[worker] Ready. Polling every ${config.pollIntervalMs}ms.`);

  let shutdown = false;
  const stop = (signal: string) => {
    console.log(`[worker] ${signal} — draining then exiting`);
    shutdown = true;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  while (!shutdown) {
    try {
      const manifest = await claimNext(pool);
      if (!manifest) {
        await new Promise((r) => setTimeout(r, config.pollIntervalMs));
        continue;
      }

      console.log(`[worker] Running manifest ${manifest.id}`);
      await withTenant(
        pool,
        { orgId: manifest.org_id, workspaceId: manifest.workspace_id },
        async (client) => {
          const result = await runCoverage(client, manifest, { artifacts });
          console.log(`[worker] ${manifest.id} → ${result.status}: ${result.message}`);
        },
      );
    } catch (err) {
      console.error(`[worker] Error in poll loop:`, err);
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }
  }

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
