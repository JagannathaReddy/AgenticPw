import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Steward suite runner (Milestone D).
 *
 * Unlike judge-runner (one spec, trace on), this runs the WHOLE suite with
 * tracing off — the Steward repeats it several times and only needs per-test
 * outcomes, not debugging artifacts.
 */

interface ReporterError {
  message?: string;
}

interface ReporterResult {
  status?: string;
  duration?: number;
  errors?: ReporterError[];
}

interface ReporterTest {
  projectName?: string;
  results?: ReporterResult[];
}

interface ReporterSpec {
  title?: string;
  file?: string;
  tests?: ReporterTest[];
}

interface ReporterSuite {
  title?: string;
  file?: string;
  specs?: ReporterSpec[];
  suites?: ReporterSuite[];
}

interface ReporterJson {
  suites?: ReporterSuite[];
  stats?: { expected?: number; unexpected?: number; skipped?: number; flaky?: number };
  config?: { rootDir?: string };
}

export interface TestResultRow {
  file: string;
  title: string;
  project: string | null;
  /** Final attempt's status: passed | failed | timedOut | skipped | interrupted */
  status: string;
  durationMs: number;
  /** First line of the final attempt's first error, or null. Display signature. */
  errorHead: string | null;
  /** Full first-error message (ANSI-stripped, capped) — what the classifier reads. */
  errorFull: string | null;
  /** True when earlier attempts failed but the final one passed (retry flake). */
  retried: boolean;
}

export interface SuiteRunOutcome {
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  results: TestResultRow[];
  stats: { total: number; passed: number; failed: number; skipped: number };
  outputTail: string;
}

function stripAnsi(s: string): string {
  // Strip ANSI escapes so signatures compare across color settings.
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function firstLine(s: string | undefined): string | null {
  if (!s) return null;
  return stripAnsi(s).split('\n').find((l) => l.trim().length > 0)?.trim() ?? null;
}

const ERROR_FULL_CAP = 1500;

function fullError(s: string | undefined): string | null {
  if (!s) return null;
  return stripAnsi(s).trim().slice(0, ERROR_FULL_CAP) || null;
}

/**
 * Recursively flatten Playwright's nested suite tree into per-test rows.
 *
 * `filePrefix` re-bases the reporter's testDir-relative file paths to be
 * repo-relative (e.g. 'tests/'), so `agent heal <file>` suggestions in the
 * health report point at real paths.
 */
export function extractTestResults(
  json: ReporterJson | null,
  filePrefix = '',
): TestResultRow[] {
  const rows: TestResultRow[] = [];
  if (!json) return rows;

  const rebase = (f: string): string =>
    filePrefix ? `${filePrefix.replace(/\/$/, '')}/${f}` : f;

  const walk = (suite: ReporterSuite, inheritedFile: string): void => {
    const file = suite.file ?? inheritedFile;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const attempts = t.results ?? [];
        if (attempts.length === 0) continue;
        const final = attempts[attempts.length - 1];
        rows.push({
          file: rebase(spec.file ?? file),
          title: spec.title ?? '(untitled)',
          project: t.projectName ?? null,
          status: final.status ?? 'failed',
          durationMs: Math.round(final.duration ?? 0),
          errorHead: firstLine(final.errors?.[0]?.message),
          errorFull: fullError(final.errors?.[0]?.message),
          retried: attempts.length > 1 && final.status === 'passed',
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, file);
  };

  for (const suite of json.suites ?? []) walk(suite, suite.file ?? '(unknown)');
  return rows;
}

export interface RunSuiteOptions {
  project?: string | null;
}

/** testDir relative to the repo root, from the reporter's config.rootDir. */
function filePrefixFrom(json: ReporterJson | null, repoRoot: string): string {
  const rootDir = json?.config?.rootDir;
  if (!rootDir) return '';
  const abs = path.resolve(repoRoot);
  const rd = path.resolve(rootDir);
  if (rd === abs) return '';
  if (!rd.startsWith(abs + path.sep)) return '';
  return path.relative(abs, rd).split(path.sep).join('/');
}

export async function runPlaywrightSuite(
  repoRoot: string,
  timeoutMs: number,
  options: RunSuiteOptions = {},
): Promise<SuiteRunOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = ['playwright', 'test', '--reporter=json'];
    const project =
      options.project === null || options.project === ''
        ? undefined
        : options.project ?? process.env.PLAYWRIGHT_PROJECT ?? undefined;
    if (project) args.push(`--project=${project}`);

    const proc = spawn('npx', args, {
      cwd: repoRoot,
      env: { ...process.env, CI: '1' },
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killer: NodeJS.Timeout | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      killer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, timeoutMs);

    proc.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
    proc.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      let json: ReporterJson | null = null;
      const jsonStart = stdout.indexOf('{');
      if (jsonStart >= 0) {
        try {
          json = JSON.parse(stdout.slice(jsonStart)) as ReporterJson;
        } catch {
          json = null;
        }
      }
      const results = extractTestResults(json, filePrefixFrom(json, repoRoot));
      const passed = results.filter((r) => r.status === 'passed').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;
      resolve({
        exitCode: code ?? 1,
        timedOut,
        durationMs: Date.now() - started,
        results,
        stats: {
          total: results.length,
          passed,
          skipped,
          failed: results.length - passed - skipped,
        },
        outputTail: `${stdout}\n${stderr}`.slice(-2000),
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        timedOut: false,
        durationMs: Date.now() - started,
        results: [],
        stats: { total: 0, passed: 0, failed: 0, skipped: 0 },
        outputTail: err.message,
      });
    });
  });
}
