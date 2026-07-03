import { spawn } from 'node:child_process';

/**
 * Spawn `npx playwright test <testRelPath>` from the repo root and capture
 * the JSON reporter output. Enforces a wall-clock timeout via SIGTERM
 * escalating to SIGKILL.
 */

export interface PlaywrightSuiteJson {
  stats?: { expected?: number; unexpected?: number; skipped?: number; flaky?: number };
  suites?: Array<{
    specs?: Array<{
      tests?: Array<{
        results?: Array<{
          status?: string;
          duration?: number;
          errors?: Array<{ message?: string; stack?: string }>;
          attachments?: Array<{ name?: string; path?: string; contentType?: string }>;
        }>;
      }>;
    }>;
  }>;
}

export interface PlaywrightRunResult {
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  json: PlaywrightSuiteJson | null;
  stdout: string;
  stderr: string;
  /** Combined output tail for logs. */
  output: string;
  /** Extracted from JSON reporter — first trace attachment path if present. */
  tracePath?: string;
}

function extractTracePath(json: PlaywrightSuiteJson | null): string | undefined {
  if (!json) return undefined;
  for (const suite of json.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          for (const att of r.attachments ?? []) {
            if (att.contentType === 'application/zip' && typeof att.path === 'string') {
              return att.path;
            }
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Flatten every `errors[].message` + `errors[].stack` in the JSON reporter
 * output into a single newline-joined string. This is what the classifier
 * regexes want — human-readable error text, not JSON structure.
 */
export function extractErrorText(json: PlaywrightSuiteJson | null): string {
  if (!json) return '';
  const parts: string[] = [];
  for (const suite of json.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          for (const err of r.errors ?? []) {
            if (typeof err.message === 'string') parts.push(err.message);
            if (typeof err.stack === 'string') parts.push(err.stack);
          }
        }
      }
    }
  }
  return parts.join('\n\n');
}

export interface RunPlaywrightOptions {
  /**
   * Playwright project name to pass as `--project`. When undefined, no
   * `--project` flag is passed — Playwright uses the default project (or
   * runs all projects) as its own config dictates.
   *
   * Common env override: PLAYWRIGHT_PROJECT.
   */
  project?: string | null;
}

export async function runPlaywright(
  repoRoot: string,
  testRelPath: string,
  timeoutMs: number,
  options: RunPlaywrightOptions = {},
): Promise<PlaywrightRunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = [
      'playwright',
      'test',
      testRelPath,
      '--reporter=json',
      '--trace=on',
      '--workers=1',
    ];

    // Resolve the project. Priority:
    //   1. options.project (caller supplied)
    //   2. PLAYWRIGHT_PROJECT env var
    //   3. undefined → no --project flag → let Playwright default
    //
    // Passing an empty string in options.project explicitly opts out of the
    // env fallback, matching what a repo with only one project or a chain
    // of `dependencies` needs.
    const project =
      options.project === null || options.project === ''
        ? undefined
        : options.project ?? process.env.PLAYWRIGHT_PROJECT ?? undefined;
    if (project) args.push(`--project=${project}`);

    const env: NodeJS.ProcessEnv = { ...process.env, CI: '1' };
    // Playwright inherits stdio and may pick up unrelated dotenv contents on
    // some hosts; keep the base URL knob explicit so the run is deterministic.

    const proc = spawn('npx', args, {
      cwd: repoRoot,
      env,
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

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      let json: PlaywrightSuiteJson | null = null;
      // Playwright's JSON reporter emits one JSON document on stdout.
      // Some Playwright versions prepend a banner; try to isolate the object.
      const jsonStart = stdout.indexOf('{');
      if (jsonStart >= 0) {
        try {
          json = JSON.parse(stdout.slice(jsonStart)) as PlaywrightSuiteJson;
        } catch {
          json = null;
        }
      }
      const tracePath = extractTracePath(json);
      resolve({
        exitCode: code ?? 1,
        timedOut,
        durationMs: Date.now() - started,
        json,
        stdout,
        stderr,
        output: `${stdout}\n${stderr}`,
        tracePath,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        timedOut: false,
        durationMs: Date.now() - started,
        json: null,
        stdout: '',
        stderr: err.message,
        output: err.message,
      });
    });
  });
}
