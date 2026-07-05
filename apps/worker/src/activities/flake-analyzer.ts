import { classifyFailure } from './classify-failure.js';
import type { TestResultRow } from './suite-runner.js';

/**
 * Flake analyzer (Milestone D) — pure functions over repeated suite runs.
 *
 * Definitions used here:
 *   flaky          — mixed pass/fail across the batch's runs, OR passed only
 *                    after in-run retries (Playwright retry flake)
 *   always_failing — failed in every run (a real breakage, not flake)
 *   healthy        — passed in every run, no retries
 */

export interface RunBatch {
  runIndex: number;
  results: TestResultRow[];
}

export type TestVerdict = 'healthy' | 'flaky' | 'always_failing' | 'skipped';

export interface TestHealth {
  file: string;
  title: string;
  project: string | null;
  verdict: TestVerdict;
  runsSeen: number;
  passCount: number;
  failCount: number;
  retriedCount: number;
  /** Status per run index, e.g. ['passed','failed','passed'] */
  statuses: string[];
  avgDurationMs: number;
  maxDurationMs: number;
  /** Distinct first-lines of errors across failing runs. */
  errorHeads: string[];
  /** Refuse-to-heal taxonomy category from the dominant error, or null. */
  category: string | null;
}

export interface SuiteHealthReport {
  runs: number;
  totalTests: number;
  healthy: number;
  flaky: number;
  alwaysFailing: number;
  skipped: number;
  tests: TestHealth[];         // ranked: always_failing, then flaky, then rest
  slowest: TestHealth[];       // top 5 by avgDuration among non-skipped
  totalDurationMs: number;
}

function key(r: TestResultRow): string {
  return `${r.file}::${r.title}::${r.project ?? ''}`;
}

export function analyzeRuns(batches: RunBatch[], totalDurationMs: number): SuiteHealthReport {
  const byTest = new Map<string, { rows: Array<{ runIndex: number; row: TestResultRow }> }>();

  for (const batch of batches) {
    for (const row of batch.results) {
      const k = key(row);
      if (!byTest.has(k)) byTest.set(k, { rows: [] });
      byTest.get(k)!.rows.push({ runIndex: batch.runIndex, row });
    }
  }

  const tests: TestHealth[] = [];
  for (const { rows } of byTest.values()) {
    rows.sort((a, b) => a.runIndex - b.runIndex);
    const first = rows[0].row;
    const statuses = rows.map((r) => r.row.status);
    const passCount = statuses.filter((s) => s === 'passed').length;
    const skippedCount = statuses.filter((s) => s === 'skipped').length;
    const failCount = statuses.length - passCount - skippedCount;
    const retriedCount = rows.filter((r) => r.row.retried).length;
    const durations = rows.map((r) => r.row.durationMs);
    const errorHeads = Array.from(
      new Set(rows.map((r) => r.row.errorHead).filter((e): e is string => !!e)),
    );
    // Classify on the FULL error text — Playwright's first line is often just
    // "TimeoutError: locator.click: Timeout 3000ms exceeded." with the
    // pattern-matchable "waiting for getByRole(...)" detail on later lines.
    const errorFulls = rows
      .map((r) => r.row.errorFull)
      .filter((e): e is string => !!e);

    let verdict: TestVerdict;
    if (skippedCount === statuses.length) verdict = 'skipped';
    else if (failCount === 0 && retriedCount === 0) verdict = 'healthy';
    else if (failCount > 0 && passCount > 0) verdict = 'flaky';
    else if (failCount > 0 && passCount === 0) verdict = 'always_failing';
    else verdict = 'flaky'; // passed every run but needed retries

    const category =
      errorFulls.length > 0
        ? classifyFailure({ errorText: errorFulls.join('\n\n') }).category
        : errorHeads.length > 0
          ? classifyFailure({ errorText: errorHeads.join('\n') }).category
          : null;

    tests.push({
      file: first.file,
      title: first.title,
      project: first.project,
      verdict,
      runsSeen: statuses.length,
      passCount,
      failCount,
      retriedCount,
      statuses,
      avgDurationMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      maxDurationMs: Math.max(...durations),
      errorHeads,
      category,
    });
  }

  const rank: Record<TestVerdict, number> = {
    always_failing: 0,
    flaky: 1,
    healthy: 2,
    skipped: 3,
  };
  tests.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.failCount - a.failCount);

  const nonSkipped = tests.filter((t) => t.verdict !== 'skipped');
  const slowest = [...nonSkipped].sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 5);

  return {
    runs: batches.length,
    totalTests: tests.length,
    healthy: tests.filter((t) => t.verdict === 'healthy').length,
    flaky: tests.filter((t) => t.verdict === 'flaky').length,
    alwaysFailing: tests.filter((t) => t.verdict === 'always_failing').length,
    skipped: tests.filter((t) => t.verdict === 'skipped').length,
    tests,
    slowest,
    totalDurationMs,
  };
}

/**
 * Heal candidates: consistently-failing tests whose category the Triage
 * workflow will actually accept. This is what `agent batch --from-steward`
 * consumes.
 */
export function healCandidates(report: SuiteHealthReport): string[] {
  return Array.from(
    new Set(
      report.tests
        .filter(
          (t) =>
            t.verdict === 'always_failing' &&
            (t.category === 'locator_drift' || t.category === 'timing'),
        )
        .map((t) => t.file),
    ),
  );
}

export interface FlakyTarget {
  file: string;
  title: string;
}

/**
 * Quarantine targets: tests the analyzer judged flaky (mixed pass/fail or
 * retry-dependent). This is what `agent quarantine --from-steward` consumes —
 * (file, title) pairs because quarantine wraps individual tests, not files.
 */
export function flakyTargets(report: SuiteHealthReport): FlakyTarget[] {
  return report.tests
    .filter((t) => t.verdict === 'flaky')
    .map((t) => ({ file: t.file, title: t.title }));
}

export interface TrendDeltas {
  previousAt: string;
  /** Tests healthy/absent last report, flaky or always_failing now. */
  newProblems: string[];
  /** Tests that were problems last report and are healthy now. */
  fixed: string[];
  /** Problems in both reports. */
  stillBroken: string[];
}

/** Compare two reports' verdict maps. Pure; caller loads the previous report. */
export function computeTrends(
  current: SuiteHealthReport,
  previous: SuiteHealthReport,
  previousAt: string,
): TrendDeltas {
  const label = (t: TestHealth): string => `${t.file} › ${t.title}`;
  const isProblem = (v: TestVerdict): boolean => v === 'flaky' || v === 'always_failing';

  const prev = new Map(previous.tests.map((t) => [label(t), t.verdict]));
  const curr = new Map(current.tests.map((t) => [label(t), t.verdict]));

  const newProblems: string[] = [];
  const fixed: string[] = [];
  const stillBroken: string[] = [];

  for (const [name, v] of curr) {
    if (!isProblem(v)) continue;
    const before = prev.get(name);
    if (before !== undefined && isProblem(before)) stillBroken.push(name);
    else newProblems.push(name);
  }
  for (const [name, v] of prev) {
    if (!isProblem(v)) continue;
    const now = curr.get(name);
    if (now !== undefined && !isProblem(now)) fixed.push(name);
  }

  return { previousAt, newProblems, fixed, stillBroken };
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

/** Deterministic markdown health report — works with zero LLM involvement. */
export function renderHealthReport(
  report: SuiteHealthReport,
  meta: {
    repoName: string | null;
    generatedAt: string;
    executiveSummary?: string | null;
    trends?: TrendDeltas | null;
  },
): string {
  const lines: string[] = [];
  lines.push(`# Suite health report`);
  lines.push('');
  lines.push(`- **Repo:** ${meta.repoName ?? '(default repo root)'}`);
  lines.push(`- **Generated:** ${meta.generatedAt}`);
  lines.push(`- **Runs:** ${report.runs} full-suite passes, ${(report.totalDurationMs / 1000).toFixed(1)}s total`);
  lines.push('');

  if (meta.executiveSummary) {
    lines.push(`## Executive summary`);
    lines.push('');
    lines.push(meta.executiveSummary.trim());
    lines.push('');
  }

  if (meta.trends) {
    const t = meta.trends;
    lines.push(`## Since last report (${t.previousAt})`);
    lines.push('');
    if (t.newProblems.length === 0 && t.fixed.length === 0 && t.stillBroken.length === 0) {
      lines.push(`No change — same problem set as last time.`);
    } else {
      if (t.newProblems.length > 0)
        lines.push(`- 🔺 **New problems (${t.newProblems.length}):** ${t.newProblems.map((n) => `\`${n}\``).join(', ')}`);
      if (t.fixed.length > 0)
        lines.push(`- ✅ **Fixed (${t.fixed.length}):** ${t.fixed.map((n) => `\`${n}\``).join(', ')}`);
      if (t.stillBroken.length > 0)
        lines.push(`- ↔ **Still broken (${t.stillBroken.length}):** ${t.stillBroken.map((n) => `\`${n}\``).join(', ')}`);
    }
    lines.push('');
  }

  lines.push(`## Scoreboard`);
  lines.push('');
  lines.push(`| | count | share |`);
  lines.push(`|---|---|---|`);
  lines.push(`| ✅ healthy | ${report.healthy} | ${pct(report.healthy, report.totalTests)} |`);
  lines.push(`| 🎲 flaky | ${report.flaky} | ${pct(report.flaky, report.totalTests)} |`);
  lines.push(`| ❌ always failing | ${report.alwaysFailing} | ${pct(report.alwaysFailing, report.totalTests)} |`);
  lines.push(`| ⏭ skipped | ${report.skipped} | ${pct(report.skipped, report.totalTests)} |`);
  lines.push(`| total | ${report.totalTests} | |`);
  lines.push('');

  const problem = report.tests.filter((t) => t.verdict === 'flaky' || t.verdict === 'always_failing');
  if (problem.length > 0) {
    lines.push(`## Problem tests (ranked)`);
    lines.push('');
    lines.push(`| test | verdict | runs | category | error |`);
    lines.push(`|---|---|---|---|---|`);
    for (const t of problem) {
      const runsCell = t.statuses.map((s) => (s === 'passed' ? '✓' : s === 'skipped' ? '–' : '✗')).join(' ');
      const err = (t.errorHeads[0] ?? '').slice(0, 80).replace(/\|/g, '\\|');
      lines.push(
        `| \`${t.file}\` › ${t.title} | ${t.verdict === 'flaky' ? '🎲 flaky' : '❌ always failing'} | ${runsCell} | ${t.category ?? '—'} | ${err} |`,
      );
    }
    lines.push('');
    lines.push(`### Suggested next steps`);
    lines.push('');
    for (const t of problem) {
      if (t.verdict === 'always_failing' && (t.category === 'locator_drift' || t.category === 'timing')) {
        lines.push(`- \`${t.file}\` fails consistently with **${t.category}** — a heal candidate: \`npm run agent -- heal ${t.file}\``);
      } else if (t.verdict === 'always_failing') {
        lines.push(`- \`${t.file}\` fails consistently (**${t.category ?? 'unclassified'}**) — likely needs a human; heal would refuse this category.`);
      } else {
        lines.push(`- \`${t.file}\` is flaky (${t.passCount}/${t.runsSeen} passed) — check for shared state, ordering, or missing waits, or quarantine it: \`npm run agent -- quarantine --from-steward <manifestId>\``);
      }
    }
    lines.push('');
  } else {
    lines.push(`## Problem tests`);
    lines.push('');
    lines.push(`None. Every test passed in every run with no retries. 🎉`);
    lines.push('');
  }

  const quarantined = report.tests.filter((t) => t.verdict === 'skipped');
  if (quarantined.length > 0) {
    lines.push(`## Quarantined / skipped (${quarantined.length})`);
    lines.push('');
    lines.push(
      `These tests never ran (test.fixme / test.skip). They stay listed here so ` +
        `they don't rot silently — periodically remove the fixme and re-run steward ` +
        `to see if they've recovered.`,
    );
    lines.push('');
    for (const t of quarantined) {
      lines.push(`- \`${t.file}\` › ${t.title}`);
    }
    lines.push('');
  }

  if (report.slowest.length > 0) {
    lines.push(`## Slowest tests`);
    lines.push('');
    lines.push(`| test | avg | max |`);
    lines.push(`|---|---|---|`);
    for (const t of report.slowest) {
      lines.push(`| \`${t.file}\` › ${t.title} | ${(t.avgDurationMs / 1000).toFixed(1)}s | ${(t.maxDurationMs / 1000).toFixed(1)}s |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
