import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { AppConfig } from './types.js';
import type { JobQueue } from './queue.js';
import type { JobStore } from './store.js';
import type { MemoryStore } from './memory.js';
import { buildGeneratorPrompt, writeBridgeSpec } from './bridge.js';
import { assertAllowedUrl, probeTarget } from './guardrails.js';
import { errorMessage } from './errors.js';
import { runAutoLoopPipeline, runGenerateTestsOnly, runVerifyTestsOnly } from './loop.js';
import { registerStaticUi } from './static.js';

const createJobSchema = z.object({
  goal: z.string().min(1),
  url: z.string().url().optional(),
  maxSteps: z.number().int().positive().optional(),
});

class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limitPerMinute: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (bucket.count >= this.limitPerMinute) return false;
    bucket.count += 1;
    return true;
  }
}

function requireSucceededJob<T extends { status: string }>(
  job: T | null,
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
): job is T {
  if (!job) {
    reply.code(404).send({ error: 'Job not found' });
    return false;
  }
  if (job.status !== 'succeeded') {
    reply.code(400).send({ error: `Job status must be succeeded, got ${job.status}` });
    return false;
  }
  return true;
}

export async function createServer(
  config: AppConfig,
  queue: JobQueue,
  store: JobStore,
  memoryStore: MemoryStore,
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: true });
  const limiter = new RateLimiter(config.rateLimitPerMinute);

  await app.register(cors, { origin: true });

  app.addHook('onRequest', async (request, reply) => {
    const pathOnly = request.url.split('?')[0] ?? request.url;
    if (
      pathOnly === '/' ||
      pathOnly === '/app.css' ||
      pathOnly === '/app.js' ||
      pathOnly.startsWith('/v1/health')
    ) {
      return;
    }
    if (!limiter.allow(request.ip)) {
      return reply.code(429).send({ error: 'Rate limit exceeded' });
    }
  });

  await registerStaticUi(app);

  app.get('/v1/health', async () => {
    const depth = queue.depth();
    const defaultUrlProbe = config.defaultUrl
      ? await probeTarget(config.defaultUrl)
      : null;
    const memoryHosts = config.autoLearn ? await memoryStore.listHosts() : [];
    return {
      ok: true,
      queue: depth,
      stagehandEnv: config.stagehandEnv,
      hasApiKey: Boolean(config.apiKey),
      model: config.model,
      defaultUrl: config.defaultUrl || null,
      defaultUrlReachable: defaultUrlProbe?.ok ?? null,
      loopLevel: config.loopLevel,
      autoGenerate: config.autoGenerate,
      autoVerify: config.autoVerify,
      autoLearn: config.autoLearn,
      memoryHosts,
      testHeaded: config.testHeaded,
      maxHealAttempts: config.maxHealAttempts,
    };
  });

  app.get<{ Querystring: { goal?: string; url?: string } }>(
    '/v1/memory/lookup',
    async (request, reply) => {
      const goal = request.query.goal?.trim();
      const url = request.query.url?.trim();
      if (!goal || !url) {
        return reply.code(400).send({ error: 'goal and url query params are required' });
      }

      try {
        assertAllowedUrl(url, config);
      } catch (err) {
        return reply.code(400).send({ error: errorMessage(err) });
      }

      const flow = await memoryStore.lookup(goal, url);
      if (!flow) return { found: false, flow: null };

      return {
        found: true,
        flow: {
          goalHash: flow.goalHash,
          host: flow.host,
          template: flow.template,
          successCount: flow.successCount,
          locatorsCount: flow.locators.length,
          testPath: flow.testPath,
          updatedAt: flow.updatedAt,
        },
      };
    },
  );

  app.get<{ Querystring: { url?: string } }>('/v1/probe', async (request, reply) => {
    const url = request.query.url?.trim();
    if (!url) return reply.code(400).send({ error: 'url query param is required' });
    try {
      assertAllowedUrl(url, config);
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
    const probe = await probeTarget(url);
    return { url, ...probe };
  });

  app.get('/v1/jobs', async () => (await store.list()).slice(0, 50));

  app.post('/v1/jobs', async (request, reply) => {
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const job = await queue.enqueue(parsed.data);
      return reply.code(202).send({ jobId: job.id, status: job.status });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.get<{ Params: { id: string } }>('/v1/jobs/:id', async (request, reply) => {
    const job = await store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return job;
  });

  app.get<{ Params: { id: string } }>('/v1/jobs/:id/events', async (request, reply) => {
    const job = await store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (record: typeof job) => {
      reply.raw.write(`event: job\n`);
      reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
    };

    send(job);

    const unsubscribe = queue.subscribe(job.id, send);
    request.raw.on('close', () => unsubscribe());

    return reply;
  });

  app.post<{ Params: { id: string } }>('/v1/jobs/:id/cancel', async (request, reply) => {
    try {
      const job = await queue.cancel(request.params.id);
      return { jobId: job.id, status: job.status };
    } catch (err) {
      return reply.code(404).send({ error: errorMessage(err) });
    }
  });

  app.post<{ Params: { id: string } }>(
    '/v1/jobs/:id/bridge-to-tests',
    async (request, reply) => {
      const job = await store.get(request.params.id);
      if (!requireSucceededJob(job, reply)) return;

      if (config.autoGenerate) {
        try {
          return { jobId: job.id, ...(await runGenerateTestsOnly(config, store, job, memoryStore)) };
        } catch (err) {
          return reply.code(500).send({ error: errorMessage(err) });
        }
      }

      const specPath = await writeBridgeSpec(config.repoRoot, job);
      await store.setStatus(job.id, job.status, { bridgeSpecPath: specPath });
      return {
        jobId: job.id,
        specPath,
        generatorPrompt: buildGeneratorPrompt(job, specPath),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/jobs/:id/generate-tests',
    async (request, reply) => {
      const job = await store.get(request.params.id);
      if (!requireSucceededJob(job, reply)) return;

      try {
        return { jobId: job.id, ...(await runGenerateTestsOnly(config, store, job, memoryStore)) };
      } catch (err) {
        return reply.code(500).send({ error: errorMessage(err) });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/jobs/:id/verify-tests',
    async (request, reply) => {
      const job = await store.get(request.params.id);
      if (!requireSucceededJob(job, reply)) return;
      if (!job.testSpecPath) {
        return reply.code(400).send({ error: 'Job has no testSpecPath; generate tests first' });
      }

      try {
        return { jobId: job.id, ...(await runVerifyTestsOnly(config, store, job, memoryStore)) };
      } catch (err) {
        return reply.code(500).send({ error: errorMessage(err) });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/v1/jobs/:id/run-loop', async (request, reply) => {
    const job = await store.get(request.params.id);
    if (!requireSucceededJob(job, reply)) return;

    try {
      return { jobId: job.id, ...(await runAutoLoopPipeline(config, store, job, memoryStore)) };
    } catch (err) {
      return reply.code(500).send({ error: errorMessage(err) });
    }
  });

  return app;
}
