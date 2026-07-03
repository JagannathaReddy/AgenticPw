import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { runPlaywright } from './judge-runner.js';
import { verifyOutcomes } from './verify-outcomes.js';

export interface JudgeInput {
  manifestId: string;
  /** Relative to repo root, e.g. tests/autonomous/xxxx/foo.spec.ts */
  testPath: string;
  /** Relative to repo root */
  pageObjectPath: string;
  expectedOutcomes: string[];
}

export type JudgeFailureCategory =
  | 'test_failed'
  | 'test_timed_out'
  | 'test_did_not_run'
  | 'outcome_not_asserted';

export interface JudgeOutput {
  passed: boolean;
  category?: JudgeFailureCategory;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  matchedOutcomes: string[];
  outcomeCoverageRatio: number;
  outputTail: string;
  reason?: string;
  tracePath?: string;
}

/**
 * Real Judge — copies generated files into the repo, runs Playwright with
 * the JSON reporter, checks:
 *   (1) exit code == 0
 *   (2) each expected outcome appears in an assertion inside the spec
 *
 * Both gates must pass. A passing run with no outcome assertions is treated
 * as a false success — better to escalate than to ship a weakened test.
 */
export async function runJudge(
  input: JudgeInput,
  artifacts: ArtifactStore,
  config: WorkerConfig,
): Promise<JudgeOutput> {
  const repoRoot = config.repoRoot;

  // Copy generated files from the artifact store into the repo tests/ tree
  // so Playwright's testDir config picks them up.
  const specSrc = artifacts.getPath(`${input.manifestId}/${input.testPath}`);
  const pageSrc = artifacts.getPath(`${input.manifestId}/${input.pageObjectPath}`);
  const specDst = path.join(repoRoot, input.testPath);
  const pageDst = path.join(repoRoot, input.pageObjectPath);

  await fs.mkdir(path.dirname(specDst), { recursive: true });
  await fs.mkdir(path.dirname(pageDst), { recursive: true });
  await fs.copyFile(specSrc, specDst);
  await fs.copyFile(pageSrc, pageDst);

  const specContent = await fs.readFile(specDst, 'utf8');
  const astCoverage = verifyOutcomes(specContent, input.expectedOutcomes);

  const run = await runPlaywright(repoRoot, input.testPath, config.testTimeoutMs);

  await artifacts.put(
    `${input.manifestId}/judge-output.log`,
    [
      `# testPath: ${input.testPath}`,
      `# exitCode: ${run.exitCode}`,
      `# timedOut: ${run.timedOut}`,
      `# durationMs: ${run.durationMs}`,
      `# tracePath: ${run.tracePath ?? '(none)'}`,
      '',
      '── stdout ──',
      run.stdout,
      '── stderr ──',
      run.stderr,
    ].join('\n'),
  );

  const matchedOutcomes = astCoverage.perOutcome
    .filter((c) => c.matched)
    .map((c) => c.outcome);
  const outcomeCoverageRatio =
    astCoverage.totalCount === 0 ? 1 : astCoverage.matchedCount / astCoverage.totalCount;

  const outputTail = run.output.slice(-3000);

  if (run.timedOut) {
    return {
      passed: false,
      category: 'test_timed_out',
      exitCode: run.exitCode,
      timedOut: true,
      durationMs: run.durationMs,
      matchedOutcomes,
      outcomeCoverageRatio,
      outputTail,
      reason: `Playwright timed out after ${config.testTimeoutMs}ms`,
      tracePath: run.tracePath,
    };
  }

  if (run.exitCode !== 0) {
    return {
      passed: false,
      category: 'test_failed',
      exitCode: run.exitCode,
      timedOut: false,
      durationMs: run.durationMs,
      matchedOutcomes,
      outcomeCoverageRatio,
      outputTail,
      reason: `Playwright exit code ${run.exitCode}. Tail: ${outputTail.slice(-500)}`,
      tracePath: run.tracePath,
    };
  }

  if (input.expectedOutcomes.length > 0 && !astCoverage.verified) {
    const missing = astCoverage.perOutcome
      .filter((c) => !c.matched)
      .map((c) => `"${c.outcome}" (missing: ${c.missingTerms.join(', ')})`)
      .join('; ');
    return {
      passed: false,
      category: 'outcome_not_asserted',
      exitCode: run.exitCode,
      timedOut: false,
      durationMs: run.durationMs,
      matchedOutcomes,
      outcomeCoverageRatio,
      outputTail,
      reason: `Test passed but did not assert expected outcomes: ${missing}`,
      tracePath: run.tracePath,
    };
  }

  return {
    passed: true,
    exitCode: 0,
    timedOut: false,
    durationMs: run.durationMs,
    matchedOutcomes,
    outcomeCoverageRatio,
    outputTail,
    tracePath: run.tracePath,
  };
}
