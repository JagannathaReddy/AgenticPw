import fs from 'node:fs/promises';
import path from 'node:path';
import type { JobRecord } from './types.js';

interface RunLog {
  phase: string;
  iteration: number;
  masterIteration: number;
  lastAgent: string | null;
  testsHealed: string[];
  healAttempts: Record<string, number>;
  stoppedReason: string | null;
  source?: string;
  lastJobId?: string;
  testPath?: string;
}

export async function recordLoopVerify(
  repoRoot: string,
  job: JobRecord,
  testPath: string,
  outcome: 'passed' | 'failed',
  healAttempts: number,
): Promise<void> {
  const loopDir = path.join(repoRoot, '.loop');
  const runLogPath = path.join(loopDir, 'run-log.json');
  const lastRunPath = path.join(loopDir, 'last-run.json');

  await fs.mkdir(loopDir, { recursive: true });

  let runLog: RunLog = {
    phase: 'verify',
    iteration: 0,
    masterIteration: 1,
    lastAgent: 'agent-server-healer',
    testsHealed: [],
    healAttempts: {},
    stoppedReason: null,
  };

  try {
    runLog = { ...runLog, ...JSON.parse(await fs.readFile(runLogPath, 'utf8')) };
  } catch {
    // fresh log
  }

  runLog.phase = 'verify';
  runLog.lastAgent = 'agent-server-healer';
  runLog.source = 'agent-server';
  runLog.lastJobId = job.id;
  runLog.testPath = testPath;
  runLog.healAttempts[job.id] = healAttempts;
  runLog.stoppedReason = outcome === 'passed' ? 'tests_passed' : 'tests_failed';

  if (healAttempts > 0 && outcome === 'passed') {
    if (!runLog.testsHealed.includes(testPath)) {
      runLog.testsHealed.push(testPath);
    }
  }

  await fs.writeFile(runLogPath, JSON.stringify(runLog, null, 2) + '\n');
  await fs.writeFile(
    lastRunPath,
    JSON.stringify(
      {
        exitCode: outcome === 'passed' ? 0 : 1,
        failedTests: outcome === 'passed' ? [] : [testPath],
        jobId: job.id,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
}
