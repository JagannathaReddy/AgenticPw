import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { devAuthHook } from './auth.js';
import { registerAnalysesRoutes } from './routes/analyses.js';
import { registerAssignmentsRoutes, registerWebhookRoutes } from './routes/assignments.js';
import { registerBatchesRoutes } from './routes/batches.js';
import { registerConsoleDataRoutes } from './routes/console-data.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerHealsRoutes } from './routes/heals.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImprovesRoutes } from './routes/improves.js';
import { registerQuarantinesRoutes } from './routes/quarantines.js';
import { registerReposRoutes } from './routes/repos.js';
import { registerStewardsRoutes } from './routes/stewards.js';
import { registerTeammateStateRoutes } from './routes/teammate-state.js';
import { registerTestsRoutes } from './routes/tests.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const db = createPool(config);

  await app.register(cors, { origin: true });

  app.addHook('onRequest', devAuthHook(config));

  registerHealthRoutes(app, db);
  registerReposRoutes(app, db);
  registerTestsRoutes(app, db);
  registerHealsRoutes(app, db);
  registerImprovesRoutes(app, db);
  registerStewardsRoutes(app, db);
  registerBatchesRoutes(app, db);
  registerFeedbackRoutes(app, db);
  registerQuarantinesRoutes(app, db);
  registerAnalysesRoutes(app, db);
  registerAssignmentsRoutes(app, db);
  registerWebhookRoutes(app, db);
  registerTeammateStateRoutes(app, db);
  registerConsoleDataRoutes(app, db);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down API');
    try {
      await app.close();
      await db.end();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { workspaceId: config.devWorkspaceId, orgId: config.devOrgId },
    `API listening on http://${config.host}:${config.port}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
