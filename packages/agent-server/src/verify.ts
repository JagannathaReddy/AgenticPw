import type { AppConfig, JobRecord } from './types.js';
import type { JobStore } from './store.js';
import { recordLoopVerify } from './loop-log.js';
import type { MemoryStore } from './memory.js';
import {
  healGeneratedTest,
  readGeneratedTest,
  runPlaywrightTest,
  writeGeneratedTest,
} from './healer.js';
import { testContentCoversGoal } from './agent-quality.js';
import { captureFailureA11yContext } from './failure-context.js';

export interface VerifyResult {
  passed: boolean;
  attempts: number;
  output: string;
  loopStatus: 'tests_passed' | 'tests_failed';
}

export async function runVerifyAndHeal(
  config: AppConfig,
  store: JobStore,
  job: JobRecord,
  repoRoot: string,
  testRelPath: string,
  memoryStore?: MemoryStore,
): Promise<VerifyResult> {
  const maxAttempts = config.maxHealAttempts;
  let healAttempts = 0;
  let lastOutput = '';
  const memoryFlow =
    config.autoLearn && memoryStore ? await memoryStore.findFlow(job) : null;

  while (healAttempts <= maxAttempts) {
    await store.appendEvent(job.id, {
      type: 'log',
      message:
        healAttempts === 0
          ? `Running playwright test ${testRelPath}${config.testHeaded ? ' (headed)' : ''}`
          : `Re-running playwright test after heal attempt ${healAttempts}${config.testHeaded ? ' (headed)' : ''}`,
    });

    const run = await runPlaywrightTest(
      repoRoot,
      testRelPath,
      config.testTimeoutMs,
      config.testHeaded,
      healAttempts > 0,
    );
    lastOutput = run.output;

    if (run.exitCode === 0) {
      const testContent = await readGeneratedTest(repoRoot, testRelPath);
      if (testContentCoversGoal(testContent, job)) {
        await store.setStatus(job.id, job.status, {
          loopStatus: 'tests_passed',
          loopVerifyAttempts: healAttempts,
        });
        await store.appendEvent(job.id, {
          type: 'log',
          message: `Tests passed (${testRelPath})`,
          data: { healAttempts },
        });
        await recordLoopVerify(repoRoot, job, testRelPath, 'passed', healAttempts);
        return { passed: true, attempts: healAttempts, output: lastOutput, loopStatus: 'tests_passed' };
      }

      lastOutput +=
        '\n[agent-server] Test passed but does not assert goal outcomes; treating as verify failure.';
      await store.appendEvent(job.id, {
        type: 'log',
        message: 'Verify gate: generated test does not assert expected outcomes from the goal',
      });
    }

    if (healAttempts >= maxAttempts) break;

    const testContent = await readGeneratedTest(repoRoot, testRelPath);
    const a11yContext =
      config.healA11y
        ? await captureFailureA11yContext(
            config,
            job,
            testRelPath,
            testContent,
            healAttempts + 1,
            config.testHeaded,
            Math.min(config.testTimeoutMs, 60_000),
          )
        : null;

    if (a11yContext) {
      await store.appendEvent(job.id, {
        type: 'log',
        message: `Captured accessibility tree for heal (${a11yContext.snapshotPath})`,
        data: { url: a11yContext.url, healAttempt: healAttempts + 1 },
      });
    }

    const patch = await healGeneratedTest(
      repoRoot,
      testRelPath,
      job,
      run.output,
      config,
      memoryFlow,
      a11yContext,
    );
    if (!patch) {
      await store.appendEvent(job.id, {
        type: 'log',
        message: 'No heal patch applied; stopping heal loop',
      });
      break;
    }

    healAttempts += 1;
    if (patch.pageObjectPath && patch.pageObjectContent) {
      await writeGeneratedTest(repoRoot, patch.pageObjectPath, patch.pageObjectContent);
    }
    await writeGeneratedTest(repoRoot, testRelPath, patch.content);
    await store.appendEvent(job.id, {
      type: 'log',
      message: `Heal attempt ${healAttempts}: ${patch.description}`,
    });
  }

  await store.setStatus(job.id, job.status, {
    loopStatus: 'tests_failed',
    loopVerifyAttempts: healAttempts,
  });
  await store.appendEvent(job.id, {
    type: 'error',
    message: `Tests failed after ${healAttempts} heal attempt(s)`,
    data: { outputTail: lastOutput.slice(-1500) },
  });
  await recordLoopVerify(repoRoot, job, testRelPath, 'failed', healAttempts);

  return {
    passed: false,
    attempts: healAttempts,
    output: lastOutput,
    loopStatus: 'tests_failed',
  };
}
