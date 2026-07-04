import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRuns,
  computeTrends,
  healCandidates,
  renderHealthReport,
} from './flake-analyzer.js';
import { extractTestResults, type TestResultRow } from './suite-runner.js';

const row = (over: Partial<TestResultRow>): TestResultRow => ({
  file: 'tests/a.spec.ts',
  title: 'test a',
  project: 'chromium',
  status: 'passed',
  durationMs: 1000,
  errorHead: null,
  errorFull: over.errorHead ?? null,
  retried: false,
  ...over,
});

// ── analyzeRuns verdicts ───────────────────────────────────────────────────

test('mixed pass/fail across runs → flaky', () => {
  const r = analyzeRuns(
    [
      { runIndex: 1, results: [row({ status: 'passed' })] },
      { runIndex: 2, results: [row({ status: 'failed', errorHead: 'Error: strict mode violation: locator resolved to 3 elements' })] },
      { runIndex: 3, results: [row({ status: 'passed' })] },
    ],
    9000,
  );
  assert.equal(r.flaky, 1);
  assert.equal(r.tests[0].verdict, 'flaky');
  assert.deepEqual(r.tests[0].statuses, ['passed', 'failed', 'passed']);
  assert.equal(r.tests[0].category, 'locator_drift');
});

test('failed in every run → always_failing', () => {
  const r = analyzeRuns(
    [
      { runIndex: 1, results: [row({ status: 'failed', errorHead: 'x' })] },
      { runIndex: 2, results: [row({ status: 'timedOut', errorHead: 'x' })] },
    ],
    5000,
  );
  assert.equal(r.alwaysFailing, 1);
  assert.equal(r.tests[0].verdict, 'always_failing');
});

test('passed every run but needed in-run retries → flaky', () => {
  const r = analyzeRuns(
    [
      { runIndex: 1, results: [row({ retried: true })] },
      { runIndex: 2, results: [row({})] },
    ],
    4000,
  );
  assert.equal(r.tests[0].verdict, 'flaky');
});

test('passed clean every run → healthy; skipped everywhere → skipped', () => {
  const r = analyzeRuns(
    [
      {
        runIndex: 1,
        results: [row({}), row({ title: 'skipped one', status: 'skipped' })],
      },
      {
        runIndex: 2,
        results: [row({}), row({ title: 'skipped one', status: 'skipped' })],
      },
    ],
    4000,
  );
  assert.equal(r.healthy, 1);
  assert.equal(r.skipped, 1);
});

test('ranking: always_failing before flaky before healthy', () => {
  const r = analyzeRuns(
    [
      {
        runIndex: 1,
        results: [
          row({ title: 'ok' }),
          row({ title: 'flaky one', status: 'failed', errorHead: 'e' }),
          row({ title: 'broken', status: 'failed', errorHead: 'e' }),
        ],
      },
      {
        runIndex: 2,
        results: [
          row({ title: 'ok' }),
          row({ title: 'flaky one', status: 'passed' }),
          row({ title: 'broken', status: 'failed', errorHead: 'e' }),
        ],
      },
    ],
    8000,
  );
  assert.deepEqual(
    r.tests.map((t) => t.title),
    ['broken', 'flaky one', 'ok'],
  );
});

// ── extractTestResults ─────────────────────────────────────────────────────

test('flattens nested suites and keeps final attempt', () => {
  const rows = extractTestResults({
    suites: [
      {
        file: 'tests/outer.spec.ts',
        suites: [
          {
            title: 'inner describe',
            specs: [
              {
                title: 'retries then passes',
                file: 'tests/outer.spec.ts',
                tests: [
                  {
                    projectName: 'chromium',
                    results: [
                      { status: 'failed', duration: 900, errors: [{ message: 'boom\nstack' }] },
                      { status: 'passed', duration: 500 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'passed');
  assert.equal(rows[0].retried, true);
  assert.equal(rows[0].durationMs, 500);
});

test('filePrefix re-bases reporter paths to repo-relative', () => {
  const rows = extractTestResults(
    {
      suites: [
        {
          specs: [
            {
              title: 't',
              file: 'foo.spec.ts',
              tests: [{ results: [{ status: 'passed', duration: 10 }] }],
            },
          ],
        },
      ],
    },
    'tests',
  );
  assert.equal(rows[0].file, 'tests/foo.spec.ts');
});

test('error head strips to first non-empty line', () => {
  const rows = extractTestResults({
    suites: [
      {
        specs: [
          {
            title: 't',
            file: 'tests/x.spec.ts',
            tests: [{ results: [{ status: 'failed', errors: [{ message: '\nTimeoutError: locator not found\n  at foo' }] }] }],
          },
        ],
      },
    ],
  });
  assert.equal(rows[0].errorHead, 'TimeoutError: locator not found');
});

// ── renderHealthReport ─────────────────────────────────────────────────────

test('report includes scoreboard, heal suggestion, and slowest table', () => {
  const r = analyzeRuns(
    [
      {
        runIndex: 1,
        results: [
          row({ title: 'ok', durationMs: 5000 }),
          row({
            title: 'broken locator',
            status: 'failed',
            errorHead: 'TimeoutError: page.getByRole: Timed out 5000ms waiting for locator("button")',
          }),
        ],
      },
      {
        runIndex: 2,
        results: [
          row({ title: 'ok', durationMs: 5200 }),
          row({
            title: 'broken locator',
            status: 'failed',
            errorHead: 'TimeoutError: page.getByRole: Timed out 5000ms waiting for locator("button")',
          }),
        ],
      },
    ],
    20000,
  );
  const md = renderHealthReport(r, { repoName: 'demo', generatedAt: '2026-07-04' });
  assert.match(md, /## Scoreboard/);
  assert.match(md, /always failing \| 1/);
  assert.match(md, /heal candidate.*agent -- heal tests\/a\.spec\.ts/);
  assert.match(md, /## Slowest tests/);
});

test('all-green report says so', () => {
  const r = analyzeRuns([{ runIndex: 1, results: [row({})] }], 3000);
  const md = renderHealthReport(r, { repoName: null, generatedAt: 'now' });
  assert.match(md, /Every test passed in every run/);
});

test('healCandidates: always_failing + healable category only', () => {
  const locatorError =
    'TimeoutError: locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for getByRole(\'button\')';
  const productBugError = 'Response: HTTP 500 Internal Server Error at /api/checkout';
  const mk = (runIndex: number) => ({
    runIndex,
    results: [
      row({ file: 'tests/healable.spec.ts', title: 'a', status: 'failed', errorFull: locatorError }),
      row({ file: 'tests/human.spec.ts', title: 'b', status: 'failed', errorFull: productBugError }),
      row({ file: 'tests/flaky.spec.ts', title: 'c', status: runIndex === 1 ? 'failed' : 'passed', errorFull: locatorError }),
    ],
  });
  const r = analyzeRuns([mk(1), mk(2)], 5000);
  assert.deepEqual(healCandidates(r), ['tests/healable.spec.ts']);
});

test('computeTrends: new / fixed / still-broken partitions', () => {
  const report = (specs: Array<{ title: string; broken: boolean }>) =>
    analyzeRuns(
      [
        {
          runIndex: 1,
          results: specs.map((s) =>
            row({ title: s.title, status: s.broken ? 'failed' : 'passed', errorFull: s.broken ? 'e' : null }),
          ),
        },
      ],
      1000,
    );
  const prev = report([
    { title: 'was broken, now fixed', broken: true },
    { title: 'still broken', broken: true },
    { title: 'was fine', broken: false },
  ]);
  const curr = report([
    { title: 'was broken, now fixed', broken: false },
    { title: 'still broken', broken: true },
    { title: 'was fine, now broken', broken: true },
  ]);
  const t = computeTrends(curr, prev, '2026-07-01');
  assert.deepEqual(t.newProblems, ['tests/a.spec.ts › was fine, now broken']);
  assert.deepEqual(t.fixed, ['tests/a.spec.ts › was broken, now fixed']);
  assert.deepEqual(t.stillBroken, ['tests/a.spec.ts › still broken']);
});

test('classifies on the full error text when the first line is generic', () => {
  const r = analyzeRuns(
    [
      {
        runIndex: 1,
        results: [
          row({
            status: 'failed',
            errorHead: 'TimeoutError: locator.click: Timeout 3000ms exceeded.',
            errorFull:
              'TimeoutError: locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for getByRole(\'button\', { name: \'No Such Button\' })',
          }),
        ],
      },
      {
        runIndex: 2,
        results: [
          row({
            status: 'failed',
            errorHead: 'TimeoutError: locator.click: Timeout 3000ms exceeded.',
            errorFull:
              'TimeoutError: locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for getByRole(\'button\', { name: \'No Such Button\' })',
          }),
        ],
      },
    ],
    6000,
  );
  assert.equal(r.tests[0].category, 'locator_drift');
});
