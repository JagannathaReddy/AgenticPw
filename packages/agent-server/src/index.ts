import { loadConfig, assertConfig } from './config.js';
import { JobStore } from './store.js';
import { JobQueue } from './queue.js';
import { MemoryStore } from './memory.js';
import { runStagehandJob } from './worker.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Allow health-only mode without API key for CI smoke checks
  const requireApiKey = process.env.AGENT_REQUIRE_API_KEY !== 'false';
  if (requireApiKey) {
    assertConfig(config);
  }

  const store = new JobStore(config);
  await store.init();

  const memoryStore = new MemoryStore(config);
  await memoryStore.init();

  const queue = new JobQueue(store, config, (job, abortController) =>
    runStagehandJob(job, abortController, config, store, memoryStore),
  );

  const app = await createServer(config, queue, store, memoryStore);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down agent daemon');
    try {
      await app.close();
      await queue.waitForIdle(Math.min(config.jobTimeoutMs, 60_000)).catch(() => undefined);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Agent daemon listening on http://${config.host}:${config.port}`);
  app.log.info(`Agent console UI at http://${config.host}:${config.port}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
