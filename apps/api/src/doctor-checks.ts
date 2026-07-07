import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, resolveArtifactsDir } from './repo-root.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fixHint?: string;
}

async function check(name: string, fn: () => Promise<Omit<DoctorCheck, 'name'>>): Promise<DoctorCheck> {
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

export async function runDoctorChecks(apiBase: string): Promise<DoctorCheck[]> {
  return Promise.all([
    check('Node 22+', async () => {
      const v = process.versions.node;
      const major = Number(v.split('.')[0]);
      const ok = major >= 22;
      return {
        ok,
        detail: `${v}${ok ? ' (>= 22)' : ' — need >= 22'}`,
        fixHint: ok ? undefined : 'Upgrade Node to 22+.',
      };
    }),
    check('Docker daemon', async () => {
      const p = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
      const ok = p.status === 0 && p.stdout.trim().length > 0;
      return {
        ok,
        detail: ok ? p.stdout.trim() : 'docker CLI missing or daemon not running',
        fixHint: ok ? undefined : 'Start Docker Desktop.',
      };
    }),
    check('Postgres reachable', async () => {
      const p = spawnSync(
        'docker',
        ['exec', 'test-agent-postgres', 'pg_isready', '-U', 'platform', '-d', 'platform'],
        { encoding: 'utf8' },
      );
      const ok = p.status === 0;
      return {
        ok,
        detail: ok ? 'test-agent-postgres accepting connections' : `pg_isready failed (exit ${p.status})`,
        fixHint: ok ? undefined : 'Run: docker compose up -d postgres',
      };
    }),
    check('Migrations applied', async () => {
      const q =
        "SELECT to_regclass('manifests') IS NOT NULL AS manifests, to_regclass('llm_calls') IS NOT NULL AS llm_calls;";
      const p = spawnSync(
        'docker',
        ['exec', 'test-agent-postgres', 'psql', '-U', 'platform', '-d', 'platform', '-tAc', q],
        { encoding: 'utf8' },
      );
      if (p.status !== 0) return { ok: false, detail: 'could not query Postgres', fixHint: 'Check postgres container' };
      const line = p.stdout.trim();
      const ok = line.includes('t|t');
      return {
        ok,
        detail: ok ? 'core tables present (manifests, llm_calls)' : `some tables missing (${line})`,
        fixHint: ok ? undefined : 'Run: bash scripts/db-migrate.sh',
      };
    }),
    check('Dev tenant seeded', async () => {
      const workspaceId = process.env.DEV_WORKSPACE_ID ?? '00000000-0000-0000-0000-000000000001';
      const p = spawnSync(
        'docker',
        [
          'exec',
          'test-agent-postgres',
          'psql',
          '-U',
          'platform',
          '-d',
          'platform',
          '-tAc',
          `SELECT count(*) FROM workspaces WHERE id = '${workspaceId}';`,
        ],
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
    }),
    check('API responding', async () => {
      try {
        const res = await fetchWithTimeout(`${apiBase}/v1/health`, 2000);
        const ok = res.ok;
        return {
          ok,
          detail: ok ? `${apiBase} responded ${res.status}` : `${apiBase} responded ${res.status}`,
          fixHint: ok ? undefined : 'Run: npm run dev',
        };
      } catch (err) {
        return {
          ok: false,
          detail: `${apiBase} unreachable: ${(err as Error).message.slice(0, 80)}`,
          fixHint: 'Run: npm run dev',
        };
      }
    }),
    check('LLM API key', async () => {
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
      return { ok: true, detail: `${found.map((p) => p.name).join(', ')} key(s) present` };
    }),
    check('Playwright browsers', async () => {
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
        detail: 'no chromium install found',
        fixHint: 'Run: npx playwright install chromium',
      };
    }),
    check('Artifacts directory writable', async () => {
      const dir = resolveArtifactsDir();
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
          fixHint: 'Fix permissions on ARTIFACTS_DIR.',
        };
      }
    }),
  ]);
}
