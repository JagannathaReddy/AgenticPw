import { loadConfig } from './config.js';
import { createPool, withSystem } from './db.js';
import { LocalFsStore } from './artifacts.js';
import { logger } from './logger.js';
import type { CoverageManifestRow } from './workflows/coverage.js';
import { runCoverage } from './workflows/coverage.js';
import type { OnboardingManifestRow } from './workflows/onboarding.js';
import { runOnboardingWorkflow } from './workflows/onboarding.js';
import type { TriageManifestRow } from './workflows/triage.js';
import { runTriage } from './workflows/triage.js';

const RESET_STALE_ON_BOOT = process.env.WORKER_RESET_STALE !== 'false';

interface ClaimedManifest {
  id: string;
  role: 'coverage' | 'onboarding' | 'triage';
  org_id: string;
  workspace_id: string;
  goal: unknown;
  audit: { correlationId: string };
}

async function claimNext(pool: ReturnType<typeof createPool>): Promise<ClaimedManifest | null> {
  return withSystem(pool, async (client) => {
    const { rows } = await client.query<ClaimedManifest>(
      `WITH picked AS (
         SELECT id FROM manifests
          WHERE status = 'pending' AND role IN ('coverage', 'onboarding', 'triage')
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE manifests m
          SET status = 'assigned', updated_at = now()
         FROM picked
        WHERE m.id = picked.id
        RETURNING m.id, m.role, m.org_id, m.workspace_id, m.goal, m.audit`,
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
    if (restored > 0) logger.info({ restored }, 'Re-enqueued stale manifests');
  }

  if (!config.llmApiKey) {
    logger.warn(
      'No LLM API key found (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY). Explorer / Generator / Healer / Onboarding activities will fail. Set one in .env.',
    );
  }

  logger.info(
    {
      pollIntervalMs: config.pollIntervalMs,
      model: config.llmModel,
      provider: config.llmModel.split('/')[0],
      hasApiKey: Boolean(config.llmApiKey),
    },
    'Worker ready, polling',
  );

  let shutdown = false;
  const stop = (signal: string) => {
    logger.info({ signal }, 'Received signal, draining then exiting');
    shutdown = true;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  while (!shutdown) {
    try {
      const claim = await claimNext(pool);
      if (!claim) {
        await new Promise((r) => setTimeout(r, config.pollIntervalMs));
        continue;
      }

      logger.info(
        { manifestShortId: claim.id.slice(0, 8), role: claim.role },
        'Claimed manifest',
      );

      let result: { status: string; message: string };
      if (claim.role === 'coverage') {
        result = await runCoverage(claim as unknown as CoverageManifestRow, {
          pool,
          artifacts,
          config,
        });
      } else if (claim.role === 'onboarding') {
        result = await runOnboardingWorkflow(claim as unknown as OnboardingManifestRow, {
          pool,
          artifacts,
          config,
        });
      } else {
        result = await runTriage(claim as unknown as TriageManifestRow, {
          pool,
          artifacts,
          config,
        });
      }

      logger.info(
        {
          manifestShortId: claim.id.slice(0, 8),
          role: claim.role,
          status: result.status,
          message: result.message,
        },
        'Manifest finished',
      );
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Error in poll loop');
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }
  }

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message, stack: (err as Error).stack }, 'Worker crashed');
  process.exit(1);
});
