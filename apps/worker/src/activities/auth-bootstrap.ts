import fs from 'node:fs/promises';
import path from 'node:path';
import { detectPlaywrightConfig, type DetectedProject } from './detect-playwright-config.js';
import { runPlaywrightProject } from './judge-runner.js';

export interface AuthBootstrapInput {
  repoRoot: string;
  timeoutMs?: number;
}

export interface AuthBootstrapResult {
  ok: boolean;
  setupProjectsRun: string[];
  setupProjectResults: Array<{ project: string; exitCode: number; timedOut: boolean }>;
  storageStatesFound: string[];
  errors: string[];
  durationMs: number;
}

const AUTH_DIRS = ['.auth', 'playwright/.auth', 'tests/.auth'];

async function findStorageStates(repoRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const rel of AUTH_DIRS) {
    const dir = path.join(repoRoot, rel);
    try {
      const entries = await fs.readdir(dir);
      for (const e of entries.filter((f) => f.endsWith('.json'))) {
        found.push(path.join(rel, e));
      }
    } catch {
      /* try next */
    }
  }
  return found;
}

function sortSetupProjects(projects: DetectedProject[]): DetectedProject[] {
  const setup = projects.filter((p) => p.isSetup);
  if (setup.length <= 1) return setup;

  const byName = new Map(setup.map((p) => [p.name, p]));
  const ordered: DetectedProject[] = [];
  const visited = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const p = byName.get(name);
    if (!p) return;
    for (const dep of p.dependencies) {
      if (byName.has(dep)) visit(dep);
    }
    ordered.push(p);
  }

  for (const p of setup) visit(p.name);
  return ordered;
}

export async function runAuthBootstrap(input: AuthBootstrapInput): Promise<AuthBootstrapResult> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 120_000;
  const errors: string[] = [];
  const setupProjectsRun: string[] = [];
  const setupProjectResults: AuthBootstrapResult['setupProjectResults'] = [];

  const beforeStates = await findStorageStates(input.repoRoot);
  if (beforeStates.length > 0) {
    return {
      ok: true,
      setupProjectsRun: [],
      setupProjectResults: [],
      storageStatesFound: beforeStates,
      errors: [],
      durationMs: Date.now() - started,
    };
  }

  const detected = await detectPlaywrightConfig(input.repoRoot, timeoutMs);
  if (!detected) {
    return {
      ok: false,
      setupProjectsRun,
      setupProjectResults,
      storageStatesFound: [],
      errors: ['Could not detect Playwright projects — is Playwright installed in the repo?'],
      durationMs: Date.now() - started,
    };
  }

  const setupProjects = sortSetupProjects(detected.projects);
  if (setupProjects.length === 0) {
    return {
      ok: false,
      setupProjectsRun,
      setupProjectResults,
      storageStatesFound: [],
      errors: [
        'No setup projects detected (*.setup.ts). Add an auth setup project or commit .auth/*.json storage states.',
      ],
      durationMs: Date.now() - started,
    };
  }

  for (const project of setupProjects) {
    setupProjectsRun.push(project.name);
    const run = await runPlaywrightProject(input.repoRoot, project.name, timeoutMs);
    setupProjectResults.push({
      project: project.name,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
    });
    if (run.exitCode !== 0 || run.timedOut) {
      errors.push(
        `Setup project "${project.name}" failed (exit ${run.exitCode}${run.timedOut ? ', timed out' : ''})`,
      );
    }
  }

  const storageStatesFound = await findStorageStates(input.repoRoot);
  const ok = storageStatesFound.length > 0 && errors.length === 0;

  if (!ok && storageStatesFound.length === 0 && errors.length === setupProjects.length) {
    errors.push('Setup projects ran but no .auth/*.json storage states were created.');
  }

  return {
    ok,
    setupProjectsRun,
    setupProjectResults,
    storageStatesFound,
    errors,
    durationMs: Date.now() - started,
  };
}
