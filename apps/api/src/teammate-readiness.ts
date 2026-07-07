import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoopReadiness, LoopReadinessCheck, LoopReadinessLabel } from '@poc/types';

const AUTH_SETUP_PATTERNS = [
  /\.auth\//i,
  /globalSetup/i,
  /storageState/i,
  /auth\.setup/i,
  /ENOENT.*\.json/i,
];

export interface StewardResultSnapshot {
  healthy?: number;
  alwaysFailing?: number;
  flaky?: number;
  healCandidates?: string[];
  envSetupFailureCount?: number;
}

function scoreLabel(score: number): LoopReadinessLabel {
  if (score >= 80) return 'ready';
  if (score >= 50) return 'partial';
  return 'blocked';
}

function countEnvSetupFromSteward(result: Record<string, unknown> | null): number {
  if (!result) return 0;
  const explicit = result.envSetupFailureCount;
  if (typeof explicit === 'number') return explicit;
  const tests = (result.tests as Array<{ file?: string; errorHeads?: string[] }> | undefined) ?? [];
  return tests.filter((t) => {
    const file = t.file;
    return (
      (typeof file === 'string' && AUTH_SETUP_PATTERNS.some((p) => p.test(file))) ||
      (t.errorHeads ?? []).some((h) => AUTH_SETUP_PATTERNS.some((p) => p.test(h)))
    );
  }).length;
}

async function authStorageStatesExist(localPath: string): Promise<{ ok: boolean; detail: string; fixHint?: string }> {
  const candidates = ['.auth', 'playwright/.auth', 'tests/.auth'];
  for (const rel of candidates) {
    const dir = path.join(localPath, rel);
    try {
      const entries = await fs.readdir(dir);
      const jsonFiles = entries.filter((e) => e.endsWith('.json'));
      if (jsonFiles.length > 0) {
        return { ok: true, detail: `${jsonFiles.length} storage state file(s) in ${rel}/` };
      }
    } catch {
      /* try next */
    }
  }
  return {
    ok: false,
    detail: 'No .auth/*.json storage states found under repo root',
    fixHint: 'Run: npm run agent -- auth-bootstrap --repo <shortId>',
  };
}

export async function buildLoopReadiness(input: {
  repo: {
    localPath: string | null;
    status: string;
    onboardedAt: string | null;
  };
  lastSteward: {
    status: string;
    finishedAt: string | null;
    result: Record<string, unknown> | null;
  } | null;
  envSetupFailures: number;
  platform: {
    llmKey: boolean;
    playwrightBrowsers: boolean;
  };
}): Promise<LoopReadiness> {
  const checks: LoopReadinessCheck[] = [];

  const onboarded =
    input.repo.status === 'active' ||
    input.repo.onboardedAt !== null;
  checks.push({
    id: 'repo_onboarded',
    label: 'Repo onboarded',
    ok: onboarded,
    detail: onboarded ? 'RepoProfile extracted' : `Repo status is "${input.repo.status}"`,
    fixHint: onboarded ? undefined : 'Run onboard from Repos or `agent onboard <repoId>`.',
  });

  let localPathOk = false;
  if (!input.repo.localPath) {
    checks.push({
      id: 'local_path',
      label: 'Local path',
      ok: false,
      detail: 'No local_path on repository row',
      fixHint: 'Re-register the repo with `agent init`.',
    });
  } else {
    try {
      await fs.access(input.repo.localPath);
      localPathOk = true;
      checks.push({
        id: 'local_path',
        label: 'Local path',
        ok: true,
        detail: input.repo.localPath,
      });
    } catch {
      checks.push({
        id: 'local_path',
        label: 'Local path',
        ok: false,
        detail: `Path not accessible: ${input.repo.localPath}`,
        fixHint: 'Fix the path or re-register the repo.',
      });
    }
  }

  const steward = input.lastSteward;
  const stewardOk = steward?.status === 'succeeded';
  const stewardRecent =
    stewardOk &&
    steward.finishedAt !== null &&
    Date.now() - new Date(steward.finishedAt).getTime() < 14 * 24 * 60 * 60 * 1000;

  checks.push({
    id: 'recent_steward',
    label: 'Recent steward report',
    ok: Boolean(stewardRecent),
    detail: stewardRecent
      ? `Succeeded ${steward!.finishedAt!.slice(0, 10)}`
      : stewardOk
        ? 'Steward succeeded but is older than 14 days'
        : steward
          ? `Last steward ${steward.status}`
          : 'No steward run yet',
    fixHint: stewardRecent ? undefined : 'Run `agent steward --repo <id>` or assign a regression.',
  });

  if (steward && steward.status === 'rejected') {
    const reason = (steward.result?.reason as string | undefined) ?? 'unknown';
    checks.push({
      id: 'suite_runnable',
      label: 'Suite runnable',
      ok: false,
      detail: reason.slice(0, 160),
      fixHint: 'Fix Playwright install, auth setup, or globalSetup before closed loops can run.',
    });
  } else if (stewardOk) {
    checks.push({
      id: 'suite_runnable',
      label: 'Suite runnable',
      ok: true,
      detail: 'Last steward completed with test results',
    });
  }

  if (input.envSetupFailures > 0 && localPathOk && input.repo.localPath) {
    const auth = await authStorageStatesExist(input.repo.localPath);
    checks.push({
      id: 'auth_setup',
      label: 'Auth / storage state',
      ok: auth.ok,
      detail: auth.ok
        ? auth.detail
        : `${input.envSetupFailures} steward failure(s) look auth-related · ${auth.detail}`,
      fixHint: auth.ok ? undefined : auth.fixHint,
    });
  } else if (localPathOk && input.repo.localPath) {
    const auth = await authStorageStatesExist(input.repo.localPath);
    if (!auth.ok) {
      checks.push({
        id: 'auth_setup',
        label: 'Auth / storage state',
        ok: false,
        detail: auth.detail,
        fixHint: auth.fixHint,
      });
    }
  }

  checks.push({
    id: 'llm_key',
    label: 'LLM API key',
    ok: input.platform.llmKey,
    detail: input.platform.llmKey ? 'At least one provider key configured' : 'No LLM API key in environment',
    fixHint: input.platform.llmKey ? undefined : 'Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env',
  });

  checks.push({
    id: 'playwright_browsers',
    label: 'Playwright browsers',
    ok: input.platform.playwrightBrowsers,
    detail: input.platform.playwrightBrowsers ? 'Chromium available' : 'Chromium not found in cache',
    fixHint: input.platform.playwrightBrowsers ? undefined : 'Run: npx playwright install chromium',
  });

  const passed = checks.filter((c) => c.ok).length;
  const score = checks.length > 0 ? Math.round((passed / checks.length) * 100) : 0;

  return {
    score,
    label: scoreLabel(score),
    checks,
  };
}

export function envSetupCountFromStewardResult(result: Record<string, unknown> | null): number {
  return countEnvSetupFromSteward(result);
}

export async function platformChecks(): Promise<{ llmKey: boolean; playwrightBrowsers: boolean }> {
  const providers = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'];
  const llmKey = providers.some((k) => Boolean(process.env[k]));

  const home = process.env.HOME ?? '';
  const roots = [
    path.join(home, 'Library', 'Caches', 'ms-playwright'),
    path.join(home, '.cache', 'ms-playwright'),
    path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'),
  ];
  let playwrightBrowsers = false;
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root);
      if (entries.some((e) => e.startsWith('chromium-'))) {
        playwrightBrowsers = true;
        break;
      }
    } catch {
      /* try next */
    }
  }

  return { llmKey, playwrightBrowsers };
}
