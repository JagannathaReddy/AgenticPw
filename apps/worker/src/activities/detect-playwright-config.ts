import { spawn } from 'node:child_process';
import { resolvePlaywrightCommand } from '../playwright-spawn.js';

/**
 * Detect a target repo's Playwright project layout by asking Playwright
 * itself, via `npx playwright test --list --reporter=json`.
 *
 * Runs in the target repo, not ours. Never mutates anything. Returns null
 * if Playwright isn't installed or the config fails to load — the caller
 * treats that as "no detected projects, fall back to profile heuristics."
 */

export interface DetectedProject {
  name: string;
  dependencies: string[];
  /** True when the project only matches setup files (\*\*.setup.ts). */
  isSetup: boolean;
}

export interface DetectedPlaywrightConfig {
  projects: DetectedProject[];
  /**
   * Best guess at "the project the user is probably running." Preference:
   *   1. The first project whose dependency chain ends at a browser-like
   *      project (name matches chromium|firefox|webkit) and that isn't
   *      itself a setup project.
   *   2. The first non-setup project.
   *   3. undefined when the list is empty or all-setup.
   */
  primaryProject?: string;
  detectedAt: string;
  durationMs: number;
}

interface RawTestSpec {
  projectName?: string;
}

interface RawSuite {
  suites?: RawSuite[];
  specs?: Array<{ tests?: RawTestSpec[] }>;
}

interface RawConfig {
  projects?: Array<{
    name?: string;
    dependencies?: string[];
    testMatch?: string[] | string;
  }>;
  config?: {
    projects?: Array<{
      name?: string;
      dependencies?: string[];
      testMatch?: string[] | string;
    }>;
  };
  suites?: RawSuite[];
}

function projectIsSetup(project: { testMatch?: string[] | string }): boolean {
  const tm = project.testMatch;
  if (!tm) return false;
  const s = Array.isArray(tm) ? tm.join(' ') : tm;
  return /\.setup\./.test(s);
}

function pickPrimary(projects: DetectedProject[]): string | undefined {
  if (projects.length === 0) return undefined;

  const byName = new Map(projects.map((p) => [p.name, p]));
  function chainEndsAtBrowser(name: string, visited = new Set<string>()): boolean {
    if (visited.has(name)) return false;
    visited.add(name);
    if (/chromium|firefox|webkit|chrome|safari|edge/i.test(name)) return true;
    const p = byName.get(name);
    if (!p) return false;
    for (const dep of p.dependencies) {
      if (chainEndsAtBrowser(dep, visited)) return true;
    }
    return false;
  }

  // Rule 1: first non-setup whose chain (including itself) hits a browser
  for (const p of projects) {
    if (!p.isSetup && chainEndsAtBrowser(p.name)) return p.name;
  }
  // Rule 2: first non-setup at all
  const nonSetup = projects.find((p) => !p.isSetup);
  return nonSetup?.name;
}

/**
 * Run `npx playwright test --list --reporter=json` and parse the result.
 */
export function detectPlaywrightConfig(
  repoRoot: string,
  timeoutMs = 20_000,
): Promise<DetectedPlaywrightConfig | null> {
  return resolvePlaywrightCommand(repoRoot, 'list').then((pw) =>
    new Promise((resolve) => {
    const started = Date.now();
    const args = [...pw.prefixArgs, '--reporter=json'];
    const proc = spawn(pw.command, args, {
      cwd: repoRoot,
      env: { ...process.env, CI: '1' },
      shell: pw.shell,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGTERM'), timeoutMs);
    proc.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
    proc.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));

    proc.on('close', () => {
      clearTimeout(timer);
      const jsonStart = stdout.indexOf('{');
      if (jsonStart < 0) {
        resolve(null);
        return;
      }
      let raw: RawConfig;
      try {
        raw = JSON.parse(stdout.slice(jsonStart)) as RawConfig;
      } catch {
        resolve(null);
        return;
      }

      // Different Playwright versions put projects at either raw.projects
      // or raw.config.projects. Suites are at raw.suites (nested).
      const projectDefs =
        (raw.config?.projects && Array.isArray(raw.config.projects)
          ? raw.config.projects
          : raw.projects) ?? [];

      const projects: DetectedProject[] = projectDefs
        .filter((p) => typeof p.name === 'string' && p.name.length > 0)
        .map((p) => ({
          name: p.name as string,
          dependencies: Array.isArray(p.dependencies)
            ? (p.dependencies as string[])
            : [],
          isSetup: projectIsSetup(p),
        }));

      resolve({
        projects,
        primaryProject: pickPrimary(projects),
        detectedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    void stderr;
  }),
  );
}
