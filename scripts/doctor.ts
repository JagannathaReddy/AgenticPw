#!/usr/bin/env tsx
/**
 * agent doctor — one-shot environment health check.
 *
 * Everything a first-time developer might be missing gets a green/red row.
 * Aim: all checks complete in < 10 s, most in < 300 ms.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

const API_BASE = process.env.TEST_AGENT_API ?? 'http://127.0.0.1:3001';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  fixHint?: string;
}

async function check(name: string, fn: () => Promise<Omit<CheckResult, 'name'>>): Promise<CheckResult> {
  try {
    const r = await fn();
    return { name, ...r };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `internal error: ${(err as Error).message.slice(0, 100)}`,
    };
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 2000): Promise<Response> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: c.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkNode(): Promise<Omit<CheckResult, 'name'>> {
  const v = process.versions.node;
  const major = Number(v.split('.')[0]);
  const ok = major >= 22;
  return {
    ok,
    detail: `${v}${ok ? ' (>= 22)' : ' — need >= 22 for --env-file-if-exists'}`,
    fixHint: ok ? undefined : 'Upgrade Node to 22+ (nvm install 22; nvm use 22).',
  };
}

async function checkDocker(): Promise<Omit<CheckResult, 'name'>> {
  const p = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  const ok = p.status === 0 && p.stdout.trim().length > 0;
  return {
    ok,
    detail: ok ? p.stdout.trim() : 'docker CLI missing or daemon not running',
    fixHint: ok ? undefined : 'Start Docker Desktop (or install it).',
  };
}

async function checkPostgres(): Promise<Omit<CheckResult, 'name'>> {
  const p = spawnSync('docker', ['exec', 'test-agent-postgres', 'pg_isready', '-U', 'platform', '-d', 'platform'], { encoding: 'utf8' });
  const ok = p.status === 0;
  return {
    ok,
    detail: ok ? 'test-agent-postgres accepting connections' : `pg_isready failed (exit ${p.status})`,
    fixHint: ok ? undefined : 'Run: docker compose up -d postgres',
  };
}

async function checkMigrations(): Promise<Omit<CheckResult, 'name'>> {
  const q =
    "SELECT to_regclass('manifests') IS NOT NULL AS manifests, to_regclass('llm_calls') IS NOT NULL AS llm_calls, to_regclass('qa_assignments') IS NOT NULL AS qa_assignments;";
  const p = spawnSync('docker', ['exec', 'test-agent-postgres', 'psql', '-U', 'platform', '-d', 'platform', '-tAc', q], { encoding: 'utf8' });
  if (p.status !== 0) return { ok: false, detail: 'could not query Postgres', fixHint: 'Check postgres container' };
  const line = p.stdout.trim();
  const ok = line.includes('t|t|t');
  return {
    ok,
    detail: ok
      ? 'core tables present (manifests, llm_calls, qa_assignments)'
      : `some tables missing (${line})`,
    fixHint: ok ? undefined : 'Run: npm run db:migrate',
  };
}

async function checkDevTenant(): Promise<Omit<CheckResult, 'name'>> {
  const workspaceId = process.env.DEV_WORKSPACE_ID ?? '00000000-0000-0000-0000-000000000001';
  const p = spawnSync(
    'docker',
    ['exec', 'test-agent-postgres', 'psql', '-U', 'platform', '-d', 'platform', '-tAc', `SELECT count(*) FROM workspaces WHERE id = '${workspaceId}';`],
    { encoding: 'utf8' },
  );
  if (p.status !== 0) return { ok: false, detail: 'could not query workspaces', fixHint: 'Check postgres container' };
  const count = Number(p.stdout.trim());
  const ok = count === 1;
  return {
    ok,
    detail: ok ? `dev workspace ${workspaceId.slice(0, 8)} seeded` : `dev workspace ${workspaceId.slice(0, 8)} missing`,
    fixHint: ok ? undefined : 'Run: npm run db:seed',
  };
}

async function checkApi(): Promise<Omit<CheckResult, 'name'>> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/v1/health`, 2000);
    const ok = res.ok;
    return {
      ok,
      detail: ok ? `${API_BASE} responded ${res.status}` : `${API_BASE} responded ${res.status}`,
      fixHint: ok ? undefined : 'Run: npm run dev',
    };
  } catch (err) {
    return {
      ok: false,
      detail: `${API_BASE} unreachable: ${(err as Error).message.slice(0, 80)}`,
      fixHint: 'Run: npm run dev',
    };
  }
}

async function checkLlmKey(): Promise<Omit<CheckResult, 'name'>> {
  const providers = [
    { env: 'OPENAI_API_KEY', name: 'openai' },
    { env: 'ANTHROPIC_API_KEY', name: 'anthropic' },
    { env: 'GOOGLE_GENERATIVE_AI_API_KEY', name: 'google' },
  ];
  const found = providers.filter((p) => process.env[p.env]);
  if (found.length === 0) {
    return {
      ok: false,
      detail: 'no LLM API key set',
      fixHint: 'Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env',
    };
  }
  return {
    ok: true,
    detail: `${found.map((p) => p.name).join(', ')} key(s) present`,
  };
}

async function checkPlaywright(): Promise<Omit<CheckResult, 'name'>> {
  // Playwright stores browsers under ~/Library/Caches/ms-playwright on Mac,
  // ~/.cache/ms-playwright on Linux. Check for chromium-* subdir.
  const home = process.env.HOME ?? '';
  const roots = [
    path.join(home, 'Library', 'Caches', 'ms-playwright'),
    path.join(home, '.cache', 'ms-playwright'),
    path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'),
  ];
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root);
      const chromium = entries.filter((e) => e.startsWith('chromium-'));
      if (chromium.length > 0) {
        return { ok: true, detail: `chromium installed (${chromium[0]})` };
      }
    } catch {
      /* try next */
    }
  }
  return {
    ok: false,
    detail: 'no chromium install found in ~/.cache/ms-playwright or Library/Caches',
    fixHint: 'Run: npx playwright install chromium',
  };
}

async function checkArtifactsDir(): Promise<Omit<CheckResult, 'name'>> {
  const dir = process.env.ARTIFACTS_DIR ?? path.join(REPO_ROOT, 'local-artifacts');
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-${Date.now()}`);
    await fs.writeFile(probe, 'ok');
    await fs.rm(probe);
    return { ok: true, detail: `writable at ${dir}` };
  } catch (err) {
    return {
      ok: false,
      detail: `not writable at ${dir}: ${(err as Error).message.slice(0, 60)}`,
      fixHint: 'Fix permissions on ARTIFACTS_DIR (default ./local-artifacts).',
    };
  }
}

export async function runDoctor(argv: string[] = []): Promise<number> {
  let repoRef: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repoRef = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stdout.write('agent doctor [--repo <shortId|uuid>]\n');
      return 0;
    }
  }

  process.stdout.write('agent doctor — checking environment\n\n');

  const checks: Array<Promise<CheckResult>> = [
    check('Node 22+', checkNode),
    check('Docker daemon', checkDocker),
    check('Postgres reachable', checkPostgres),
    check('Migrations applied', checkMigrations),
    check('Dev tenant seeded', checkDevTenant),
    check('API responding', checkApi),
    check('LLM API key', checkLlmKey),
    check('Playwright browsers', checkPlaywright),
    check('Artifacts directory writable', checkArtifactsDir),
  ];

  const results = await Promise.all(checks);

  let failed = 0;
  const nameWidth = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    const name = r.name.padEnd(nameWidth);
    process.stdout.write(`${icon} ${name}  ${r.detail}\n`);
    if (!r.ok) failed++;
  }

  process.stdout.write('\n');
  if (failed === 0) {
    process.stdout.write('All good.\n');
  } else {
    process.stdout.write(`${failed} problem${failed === 1 ? '' : 's'}:\n`);
    for (const r of results) {
      if (r.ok || !r.fixHint) continue;
      process.stdout.write(`  → ${r.name}: ${r.fixHint}\n`);
    }
  }

  let loopFailed = 0;
  if (repoRef) {
    loopFailed = await printLoopReadiness(repoRef, results.find((r) => r.name === 'API responding')?.ok ?? false);
  }

  if (failed === 0 && loopFailed === 0) return 0;
  if (failed > 0 && loopFailed === 0) return 1;
  if (failed === 0 && loopFailed > 0) return 1;
  return 1;
}

async function printLoopReadiness(repoRef: string, apiOk: boolean): Promise<number> {
  process.stdout.write('\nLoop readiness\n\n');
  if (!apiOk) {
    process.stdout.write('✗ Skipped — API not responding (start npm run dev)\n');
    return 1;
  }

  try {
    const reposRes = await fetchWithTimeout(`${API_BASE}/v1/repos`, 3000);
    if (!reposRes.ok) {
      process.stdout.write(`✗ Could not list repos (${reposRes.status})\n`);
      return 1;
    }
    const repos = (await reposRes.json()) as Array<{ id: string; name: string }>;
    const needle = repoRef.toLowerCase();
    const repo =
      repos.find((r) => r.id === repoRef) ??
      repos.find((r) => r.id.startsWith(repoRef)) ??
      repos.find((r) => r.name.toLowerCase() === needle);
    if (!repo) {
      process.stdout.write(`✗ Repo not found: ${repoRef}\n`);
      return 1;
    }

    const stateRes = await fetchWithTimeout(`${API_BASE}/v1/repos/${repo.id}/teammate`, 5000);
    if (!stateRes.ok) {
      process.stdout.write(`✗ Teammate state unavailable (${stateRes.status})\n`);
      return 1;
    }
    const state = (await stateRes.json()) as {
      repoName: string;
      loopReadiness: { score: number; label: string; checks: Array<{ label: string; ok: boolean; detail: string; fixHint?: string }> };
    };

    process.stdout.write(`${state.repoName} — ${state.loopReadiness.score}% (${state.loopReadiness.label})\n\n`);
    let failed = 0;
    const nameWidth = Math.max(...state.loopReadiness.checks.map((c) => c.label.length), 12);
    for (const c of state.loopReadiness.checks) {
      const icon = c.ok ? '✓' : '✗';
      process.stdout.write(`${icon} ${c.label.padEnd(nameWidth)}  ${c.detail}\n`);
      if (!c.ok) failed++;
    }
    if (failed > 0) {
      process.stdout.write('\nLoop readiness fixes:\n');
      for (const c of state.loopReadiness.checks) {
        if (c.ok || !c.fixHint) continue;
        process.stdout.write(`  → ${c.label}: ${c.fixHint}\n`);
      }
    }
    return failed > 0 ? 1 : 0;
  } catch (err) {
    process.stdout.write(`✗ Loop readiness check failed: ${(err as Error).message.slice(0, 100)}\n`);
    return 1;
  }
}

// Only run when executed directly (not when imported by test-agent.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  runDoctor(process.argv.slice(2)).then((code) => process.exit(code));
}
