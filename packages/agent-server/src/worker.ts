import { Stagehand } from '@browserbasehq/stagehand';
import type { AppConfig, JobRecord } from './types.js';
import type { JobStore } from './store.js';
import { formatTargetError, probeTarget, assertAgentExecutionSucceeded } from './guardrails.js';
import { assertAgentRunReadyForAutoLoop } from './agent-quality.js';
import { normalizeStagehandActions } from './actions.js';
import { runAutoLoopPipeline } from './loop.js';
import { type MemoryStore } from './memory.js';
import {
  buildStagehandExecuteInstruction,
  buildStagehandSystemInstructions,
  goalContextFromJob,
} from './prompts.js';

function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('Job cancelled'));
    const timer = setTimeout(() => reject(new Error(`Job timeout after ${ms}ms`)), ms);

    if (signal.aborted) {
      clearTimeout(timer);
      reject(new Error('Job cancelled'));
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });

    promise
      .then((value) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

export async function runStagehandJob(
  job: JobRecord,
  abortController: AbortController,
  config: AppConfig,
  store: JobStore,
  memoryStore?: MemoryStore,
): Promise<void> {
  const started = Date.now();
  await store.appendEvent(job.id, {
    type: 'log',
    message: `Starting Stagehand (${config.stagehandEnv}) for ${job.url}`,
  });

  let stagehand: Stagehand | null = null;

  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => {
      void stagehand?.close().finally(() => reject(new Error('Job cancelled')));
    };
    if (abortController.signal.aborted) {
      onAbort();
      return;
    }
    abortController.signal.addEventListener('abort', onAbort, { once: true });
  });

  stagehand = new Stagehand({
    env: config.stagehandEnv,
    modelName: config.model,
    modelClientOptions: { apiKey: config.apiKey },
    ...(config.stagehandEnv === 'BROWSERBASE'
      ? { apiKey: process.env.BROWSERBASE_API_KEY }
      : {}),
  });

  try {
    const probe = await probeTarget(job.url);
    if (!probe.ok) {
      throw new Error(formatTargetError(job.url, probe.error));
    }

    await stagehand.init();
    await store.appendEvent(job.id, { type: 'log', message: 'Browser initialized' });

    const page = stagehand.page;
    try {
      await page.goto(job.url);
    } catch (err) {
      throw wrapNavigationError(job, err);
    }
    await store.appendEvent(job.id, { type: 'step', message: `Navigated to ${job.url}` });

    const goalContext = goalContextFromJob(job);

    const learnedFlow =
      config.autoLearn && memoryStore ? await memoryStore.findFlow(job) : null;
    if (learnedFlow) {
      await store.appendEvent(job.id, {
        type: 'log',
        message: `Using learned flow (${learnedFlow.successCount} prior success${learnedFlow.successCount === 1 ? '' : 'es'} on ${learnedFlow.host})`,
        data: {
          memoryFlowHash: learnedFlow.goalHash,
          template: learnedFlow.template,
          multiPhaseGoal: goalContext.isMultiPhase,
        },
      });
      await store.setStatus(job.id, 'running', { memoryFlowHash: learnedFlow.goalHash });
    }

    const agent = stagehand.agent({
      instructions: buildStagehandSystemInstructions(
        learnedFlow,
        goalContext,
        job.maxSteps,
      ),
    });

    const executePromise = agent.execute({
      instruction: buildStagehandExecuteInstruction(job, goalContext),
      maxSteps: job.maxSteps,
    });

    const result = await Promise.race([
      withTimeout(executePromise, config.jobTimeoutMs, abortController.signal),
      abortPromise,
    ]);

    const normalizedActions = normalizeStagehandActions(result.actions ?? []);
    for (const action of normalizedActions.slice(-5)) {
      await store.appendEvent(job.id, { type: 'step', message: action.summary });
    }

    await store.appendEvent(job.id, {
      type: 'log',
      message: result.message ?? 'Agent finished',
      data: { actionsCount: normalizedActions.length, durationMs: Date.now() - started, success: result.success },
    });

    assertAgentExecutionSucceeded(
      { success: result.success, message: result.message },
      normalizedActions,
    );

    const loopJob = await store.setStatus(job.id, 'running', {
      result: {
        message: result.message,
        actionsCount: normalizedActions.length,
        success: result.success,
      },
      actions: normalizedActions,
    });

    assertAgentRunReadyForAutoLoop(loopJob);

    if (config.autoBridge || config.autoGenerate || config.autoVerify) {
      await runAutoLoopPipeline(config, store, loopJob, memoryStore);
    }
  } finally {
    await stagehand?.close().catch(() => undefined);
    await store.appendEvent(job.id, {
      type: 'log',
      message: 'Browser closed',
      data: { durationMs: Date.now() - started },
    });
  }
}

function wrapNavigationError(job: JobRecord, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('ERR_CONNECTION_REFUSED') || message.includes('ECONNREFUSED')) {
    return new Error(formatTargetError(job.url, message));
  }
  return err instanceof Error ? err : new Error(message);
}
