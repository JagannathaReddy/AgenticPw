import { writeBridgeSpec, buildGeneratorPrompt } from './bridge.js';
import { assertAgentRunReadyForAutoLoop } from './agent-quality.js';
import { generateTests } from './generator.js';
import { runVerifyAndHeal } from './verify.js';
import type { MemoryStore } from './memory.js';
import type { AppConfig, FlowMemory, JobRecord, LoopPipelineResult } from './types.js';
import type { JobStore } from './store.js';

async function tagLearnedFlow(
  store: JobStore,
  job: JobRecord,
  flow: FlowMemory,
): Promise<void> {
  await store.appendEvent(job.id, {
    type: 'log',
    message: `Using learned flow (${flow.successCount} prior success${flow.successCount === 1 ? '' : 'es'} on ${flow.host})`,
    data: { memoryFlowHash: flow.goalHash, template: flow.template },
  });
  await store.setStatus(job.id, job.status, { memoryFlowHash: flow.goalHash });
}

async function loadLearnedFlow(
  config: AppConfig,
  memoryStore: MemoryStore | undefined,
  job: JobRecord,
  store: JobStore,
): Promise<FlowMemory | null> {
  if (!config.autoLearn || !memoryStore) return null;
  const flow = await memoryStore.findFlow(job);
  if (!flow) return null;
  await tagLearnedFlow(store, job, flow);
  return flow;
}

async function recordLearnedFlow(
  config: AppConfig,
  memoryStore: MemoryStore | undefined,
  store: JobStore,
  job: JobRecord,
  repoRoot: string,
  testPath: string,
  result: LoopPipelineResult,
): Promise<void> {
  if (!config.autoLearn || !memoryStore || job.loopStatus !== 'tests_passed') return;

  const flow = await memoryStore.recordFromJob(repoRoot, job, testPath);
  await store.setStatus(job.id, job.status, {
    memoryRecorded: true,
    memoryFlowHash: flow.goalHash,
  });
  await store.appendEvent(job.id, {
    type: 'log',
    message: `Recorded learned flow ${flow.goalHash} (${flow.locators.length} locators)`,
  });
  result.memoryRecorded = true;
  result.memoryFlowHash = flow.goalHash;
}

async function runVerifyStep(
  config: AppConfig,
  store: JobStore,
  job: JobRecord,
  repoRoot: string,
  testPath: string,
  result: LoopPipelineResult,
  memoryStore?: MemoryStore,
): Promise<JobRecord> {
  const verify = await runVerifyAndHeal(config, store, job, repoRoot, testPath, memoryStore);
  result.verifyPassed = verify.passed;
  result.healAttempts = verify.attempts;
  result.loopStatus = verify.loopStatus;

  const current = (await store.get(job.id)) ?? job;
  if (verify.passed) {
    await recordLearnedFlow(config, memoryStore, store, current, repoRoot, testPath, result);
  }
  return (await store.get(job.id)) ?? current;
}

async function generateFromSpec(
  config: AppConfig,
  store: JobStore,
  job: JobRecord,
  repoRoot: string,
  specPath: string,
  memoryStore?: MemoryStore,
): Promise<{ current: JobRecord; generated: Awaited<ReturnType<typeof generateTests>> }> {
  const memory = await loadLearnedFlow(config, memoryStore, job, store);
  const generated = await generateTests(repoRoot, job, specPath, memory);
  const current = await store.setStatus(job.id, job.status, {
    bridgeSpecPath: specPath,
    testSpecPath: generated.testPath,
    loopStatus: 'tests_generated',
    generatorTemplate: generated.template,
  });
  await store.appendEvent(job.id, {
    type: 'log',
    message: `Generated ${generated.testPath} + ${generated.pageObjectPath} (${generated.template})`,
  });
  return { current, generated };
}

export async function runAutoLoopPipeline(
  config: AppConfig,
  store: JobStore,
  job: JobRecord,
  memoryStore?: MemoryStore,
): Promise<LoopPipelineResult> {
  const repoRoot = config.repoRoot;
  const result: LoopPipelineResult = {};
  let current = job;

  assertAgentRunReadyForAutoLoop(current);

  if (config.autoBridge) {
    const specPath = await writeBridgeSpec(repoRoot, current);
    current = await store.setStatus(job.id, job.status, {
      bridgeSpecPath: specPath,
      loopStatus: 'spec_written',
    });
    await store.appendEvent(job.id, { type: 'log', message: `Auto-loop wrote ${specPath}` });
    result.specPath = specPath;
    result.generatorPrompt = buildGeneratorPrompt(current, specPath);
  }

  if (config.autoGenerate) {
    const specPath = result.specPath ?? current.bridgeSpecPath;
    if (!specPath) throw new Error('Cannot generate tests without a bridge spec path');

    const { current: afterGen, generated } = await generateFromSpec(
      config,
      store,
      current,
      repoRoot,
      specPath,
      memoryStore,
    );
    current = afterGen;
    result.testPath = generated.testPath;
    result.pageObjectPath = generated.pageObjectPath;
    result.template = generated.template;
  }

  if (config.autoVerify) {
    const testPath = result.testPath ?? current.testSpecPath;
    if (!testPath) throw new Error('Cannot verify tests without a generated test path');
    current = await runVerifyStep(config, store, current, repoRoot, testPath, result, memoryStore);
  }

  return result;
}

export async function runGenerateTestsOnly(
  config: AppConfig,
  store: JobStore,
  job: JobRecord,
  memoryStore?: MemoryStore,
): Promise<LoopPipelineResult> {
  assertAgentRunReadyForAutoLoop(job);

  const repoRoot = config.repoRoot;
  let specPath = job.bridgeSpecPath;

  if (!specPath) {
    specPath = await writeBridgeSpec(repoRoot, job);
    await store.setStatus(job.id, job.status, {
      bridgeSpecPath: specPath,
      loopStatus: 'spec_written',
    });
  }

  const { generated } = await generateFromSpec(
    config,
    store,
    job,
    repoRoot,
    specPath,
    memoryStore,
  );

  const result: LoopPipelineResult = {
    specPath,
    testPath: generated.testPath,
    pageObjectPath: generated.pageObjectPath,
    template: generated.template,
    generatorPrompt: buildGeneratorPrompt(job, specPath),
  };

  if (config.autoVerify) {
    await runVerifyStep(config, store, job, repoRoot, generated.testPath, result, memoryStore);
  }

  return result;
}

export async function runVerifyTestsOnly(
  config: AppConfig,
  store: JobStore,
  job: JobRecord,
  memoryStore?: MemoryStore,
): Promise<LoopPipelineResult> {
  const testPath = job.testSpecPath;
  if (!testPath) throw new Error('Job has no testSpecPath; generate tests first');

  const result: LoopPipelineResult = {
    specPath: job.bridgeSpecPath,
    testPath,
    template: job.generatorTemplate,
  };

  await runVerifyStep(config, store, job, config.repoRoot, testPath, result, memoryStore);
  return result;
}
