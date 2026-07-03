#!/usr/bin/env tsx
/**
 * test-agent CLI — thin client for the local API.
 *
 * Usage:
 *   test-agent add "<goal>" --url <url> [--outcome "..." ...] [--max-steps N]
 *   test-agent get <manifestId>
 *   test-agent list
 *
 * Environment:
 *   TEST_AGENT_API   default http://127.0.0.1:3001
 */

interface AnyManifest {
  id: string;
  status: string;
  role?: string;
  goal?: {
    kind?: string;
    description?: string;
    params?: Record<string, unknown>;
  };
  result?: Record<string, unknown> & { status?: string };
  events?: Array<{
    ts: string;
    kind: string;
    fromStatus?: string;
    toStatus?: string;
    actor?: string;
    payload?: Record<string, unknown>;
  }>;
}

interface RepoRow {
  id: string;
  name: string;
  localPath: string;
  status: string;
  profileId?: string | null;
}

const API_BASE = process.env.TEST_AGENT_API ?? 'http://127.0.0.1:3001';
const POLL_MS = 1500;

function usage(): never {
  process.stderr.write(
    `test-agent — submit and watch coverage manifests

Usage:
  test-agent add "<goal>" --url <url> [--outcome "..."] [--outcome "..."] [--max-steps N] [--repo <shortId|uuid>]
  test-agent heal <testPath> [--repo <shortId|uuid>] [--page-object <path>]
  test-agent get <manifestId>
  test-agent list

  test-agent init <local-path> [--name <name>]
  test-agent repos

Environment:
  TEST_AGENT_API   default http://127.0.0.1:3001
`,
  );
  process.exit(2);
}

async function apiCall<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    process.stderr.write(`Cannot reach ${API_BASE} — is the API running? Try: npm run dev\n`);
    process.exit(1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    process.stderr.write(`API ${res.status}: ${text.slice(0, 500)}\n`);
    process.exit(1);
  }
  return (await res.json()) as T;
}

interface AddArgs {
  goal: string;
  url: string;
  outcomes: string[];
  maxSteps?: number;
  repoRef?: string;
}

function parseAdd(argv: string[]): AddArgs {
  let goal = '';
  let url = '';
  const outcomes: string[] = [];
  let maxSteps: number | undefined;
  let repoRef: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') url = argv[++i] ?? '';
    else if (a === '--outcome') outcomes.push(argv[++i] ?? '');
    else if (a === '--max-steps') maxSteps = Number(argv[++i]);
    else if (a === '--repo') repoRef = argv[++i];
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('-')) {
      process.stderr.write(`Unknown flag: ${a}\n`);
      usage();
    } else if (!goal) goal = a;
    else {
      process.stderr.write(`Unexpected positional: ${a}\n`);
      usage();
    }
  }

  if (!goal || !url) usage();
  return { goal, url, outcomes, maxSteps, repoRef };
}

/** Resolve a --repo value (full uuid or 8-char short id) to a full uuid. */
async function resolveRepoRef(ref: string): Promise<{ id: string; name: string; hasProfile: boolean }> {
  const list = await apiCall<RepoRow[]>('/v1/repos');
  const exact = list.find((r) => r.id === ref);
  const short = ref.length === 8 ? list.find((r) => r.id.startsWith(ref)) : undefined;
  const match = exact ?? short;
  if (!match) {
    process.stderr.write(`No repo matches --repo "${ref}". Try: test-agent repos\n`);
    process.exit(1);
  }
  return { id: match.id, name: match.name, hasProfile: !!match.profileId };
}

function describeEvent(kind: string, p: Record<string, unknown>): string {
  const bits: string[] = [];
  const g = <T>(k: string): T | undefined => p[k] as T | undefined;

  const actionCount = g<number>('actionCount');
  if (actionCount !== undefined) bits.push(`${actionCount} actions`);

  const verified = g<boolean>('verified');
  if (verified !== undefined) bits.push(`verified=${verified}`);

  const usage = g<{ costUSD?: number; tokensInput?: number; tokensOutput?: number; latencyMs?: number }>('usage');
  if (usage?.costUSD !== undefined) bits.push(`$${Number(usage.costUSD).toFixed(4)}`);
  if (usage?.tokensInput !== undefined) bits.push(`${usage.tokensInput}+${usage.tokensOutput} tok`);
  if (usage?.latencyMs !== undefined) bits.push(`${usage.latencyMs}ms`);

  const durationMs = g<number>('durationMs');
  if (durationMs !== undefined && !usage) bits.push(`${durationMs}ms`);

  const passed = g<boolean>('passed');
  if (passed !== undefined) bits.push(`passed=${passed}`);

  const exitCode = g<number>('exitCode');
  if (exitCode !== undefined) bits.push(`exit=${exitCode}`);

  const category = g<string>('category');
  if (category) bits.push(`category=${category}`);

  const reason = g<string>('reason');
  if (reason) bits.push(`reason: ${String(reason).slice(0, 80)}`);

  return bits.join(' · ');
}

function printTerminal(m: AnyManifest): void {
  const status = m.status;
  const r = m.result ?? {};
  const role = m.role ?? m.goal?.kind ?? 'coverage';
  process.stdout.write('\n');
  if (status === 'succeeded') {
    if (role === 'onboarding' || m.goal?.kind === 'onboard_repo') {
      process.stdout.write(`✓ Onboarding complete\n`);
      if (r.profileId) process.stdout.write(`  profileId:   ${String(r.profileId)}\n`);
      if (r.confidence !== undefined)
        process.stdout.write(`  confidence:  ${String(r.confidence)}\n`);
      if (r.filesSampled !== undefined)
        process.stdout.write(`  files:       ${String(r.filesSampled)}\n`);
    } else if (role === 'triage' || m.goal?.kind === 'heal_test') {
      if (r.alreadyPassing) {
        process.stdout.write(`✓ Triage: test already passes — nothing to heal\n`);
        if (r.testPath) process.stdout.write(`  test: ${String(r.testPath)}\n`);
      } else {
        process.stdout.write(`✓ Triage complete — patched test passes\n`);
        if (r.category) process.stdout.write(`  category: ${String(r.category)}\n`);
        if (r.patchedTestPath)
          process.stdout.write(`  patched: ${String(r.patchedTestPath)}\n`);
        if (r.originalTestPath)
          process.stdout.write(`  original (unchanged): ${String(r.originalTestPath)}\n`);
        process.stdout.write('\n');
        if (r.patchedTestPath)
          process.stdout.write(
            `Compare:  diff ${String(r.originalTestPath)} ${String(r.patchedTestPath)}\n`,
          );
      }
    } else {
      process.stdout.write(`✓ Coverage complete\n`);
      if (r.testPath) process.stdout.write(`  spec:  ${String(r.testPath)}\n`);
      if (r.pageObjectPath) process.stdout.write(`  page:  ${String(r.pageObjectPath)}\n`);
      process.stdout.write('\n');
      if (r.testPath) process.stdout.write(`Run it:  npx playwright test ${String(r.testPath)}\n`);
    }
    return;
  }
  process.stdout.write(`✗ ${status}\n`);
  if (r.category) process.stdout.write(`  category: ${String(r.category)}\n`);
  if (r.reason) {
    process.stdout.write(`  reason:\n`);
    const lines = String(r.reason).split('\n').slice(0, 20);
    for (const line of lines) process.stdout.write(`    ${line}\n`);
  }
  process.stdout.write(`\nartifact:  local-artifacts/${m.id}/\n`);
}

async function watchManifest(id: string): Promise<void> {
  const seen = new Set<string>();
  const startTime = Date.now();

  while (true) {
    const m = await apiCall<AnyManifest>(`/v1/tests/${id}`);
    for (const ev of m.events ?? []) {
      const key = `${ev.ts}-${ev.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = ev.payload ?? {};
      const stage = (p.stage as string | undefined) ?? '';
      const detail = describeEvent(ev.kind, p);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1).padStart(5);
      const label = stage ? `${ev.kind} · ${stage}` : ev.kind;
      const suffix = detail ? ` — ${detail}` : '';
      process.stdout.write(`  [${elapsed}s] ${label}${suffix}\n`);
    }
    if (['succeeded', 'failed', 'rejected', 'cancelled'].includes(m.status)) {
      printTerminal(m);
      process.exit(m.status === 'succeeded' ? 0 : 1);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function addCommand(argv: string[]): Promise<void> {
  const args = parseAdd(argv);

  let repoId: string | undefined;
  if (args.repoRef) {
    const resolved = await resolveRepoRef(args.repoRef);
    repoId = resolved.id;
    process.stdout.write(`Repo: ${resolved.name} (${resolved.id.slice(0, 8)})`);
    process.stdout.write(resolved.hasProfile ? ` — profile ✓\n` : ` — no profile (heuristic will be used)\n`);
  }

  process.stdout.write(`Submitting manifest…\n`);
  process.stdout.write(`  goal:  ${args.goal}\n`);
  process.stdout.write(`  url:   ${args.url}\n`);
  if (args.outcomes.length > 0) {
    process.stdout.write(`  expected outcomes:\n`);
    args.outcomes.forEach((o, i) => process.stdout.write(`    ${i + 1}. ${o}\n`));
  }
  process.stdout.write('\n');

  const submitted = await apiCall<{ manifestId: string; correlationId: string }>('/v1/tests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      goal: args.goal,
      targetUrl: args.url,
      expectedOutcomes: args.outcomes,
      ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
      ...(repoId ? { repoId } : {}),
    }),
  });

  process.stdout.write(`  manifestId:    ${submitted.manifestId}\n`);
  process.stdout.write(`  correlationId: ${submitted.correlationId}\n\n`);

  await watchManifest(submitted.manifestId);
}

async function getCommand(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) {
    process.stderr.write(`Manifest id required\n`);
    usage();
  }
  const m = await apiCall<AnyManifest>(`/v1/tests/${id}`);
  process.stdout.write(`${JSON.stringify(m, null, 2)}\n`);
}

async function listCommand(): Promise<void> {
  const list = await apiCall<AnyManifest[]>('/v1/tests');
  if (list.length === 0) {
    process.stdout.write('(no manifests)\n');
    return;
  }
  for (const m of list) {
    const short = m.id.slice(0, 8);
    const goal = m.goal?.description?.slice(0, 70) ?? '';
    process.stdout.write(`${short}  ${m.status.padEnd(11)}  ${goal}\n`);
  }
}

interface InitArgs {
  localPath: string;
  name?: string;
}

function parseInit(argv: string[]): InitArgs {
  let localPath = '';
  let name: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') name = argv[++i];
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('-')) {
      process.stderr.write(`Unknown flag: ${a}\n`);
      usage();
    } else if (!localPath) localPath = a;
    else {
      process.stderr.write(`Unexpected positional: ${a}\n`);
      usage();
    }
  }
  if (!localPath) usage();
  return { localPath, name };
}

async function initCommand(argv: string[]): Promise<void> {
  const args = parseInit(argv);
  const path = await import('node:path');
  const absPath = path.resolve(args.localPath);
  const name = args.name ?? path.basename(absPath);

  process.stdout.write(`Registering repo…\n`);
  process.stdout.write(`  name: ${name}\n`);
  process.stdout.write(`  path: ${absPath}\n\n`);

  const registered = await apiCall<{ repoId: string; status: string }>('/v1/repos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, localPath: absPath }),
  });
  process.stdout.write(`  repoId: ${registered.repoId}\n`);
  process.stdout.write(`  status: ${registered.status}\n\n`);

  process.stdout.write(`Kicking off onboarding…\n`);
  const submitted = await apiCall<{ manifestId: string; correlationId: string }>(
    `/v1/repos/${registered.repoId}/onboard`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  );
  process.stdout.write(`  manifestId:    ${submitted.manifestId}\n`);
  process.stdout.write(`  correlationId: ${submitted.correlationId}\n\n`);

  await watchManifest(submitted.manifestId);
}

interface HealArgs {
  testPath: string;
  pageObjectPath?: string;
  repoRef?: string;
}

function parseHeal(argv: string[]): HealArgs {
  let testPath = '';
  let pageObjectPath: string | undefined;
  let repoRef: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repoRef = argv[++i];
    else if (a === '--page-object') pageObjectPath = argv[++i];
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('-')) {
      process.stderr.write(`Unknown flag: ${a}\n`);
      usage();
    } else if (!testPath) testPath = a;
    else {
      process.stderr.write(`Unexpected positional: ${a}\n`);
      usage();
    }
  }
  if (!testPath) usage();
  return { testPath, pageObjectPath, repoRef };
}

async function healCommand(argv: string[]): Promise<void> {
  const args = parseHeal(argv);

  let repoId: string | undefined;
  if (args.repoRef) {
    const resolved = await resolveRepoRef(args.repoRef);
    repoId = resolved.id;
    process.stdout.write(`Repo: ${resolved.name} (${resolved.id.slice(0, 8)})`);
    process.stdout.write(resolved.hasProfile ? ` — profile ✓\n` : ` — no profile\n`);
  }

  process.stdout.write(`Submitting heal manifest…\n`);
  process.stdout.write(`  test:  ${args.testPath}\n`);
  if (args.pageObjectPath) process.stdout.write(`  page:  ${args.pageObjectPath}\n`);
  process.stdout.write('\n');

  const submitted = await apiCall<{ manifestId: string; correlationId: string }>('/v1/heals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      testPath: args.testPath,
      ...(args.pageObjectPath ? { pageObjectPath: args.pageObjectPath } : {}),
      ...(repoId ? { repoId } : {}),
    }),
  });

  process.stdout.write(`  manifestId:    ${submitted.manifestId}\n`);
  process.stdout.write(`  correlationId: ${submitted.correlationId}\n\n`);

  await watchManifest(submitted.manifestId);
}

async function reposCommand(): Promise<void> {
  const list = await apiCall<
    Array<{ id: string; name: string; localPath: string; status: string; profileId?: string }>
  >('/v1/repos');
  if (list.length === 0) {
    process.stdout.write('(no repos registered — try `test-agent init <path>`)\n');
    return;
  }
  for (const r of list) {
    const shortId = r.id.slice(0, 8);
    const profile = r.profileId ? '· has profile' : '';
    process.stdout.write(`${shortId}  ${r.status.padEnd(11)}  ${r.name}  ${profile}\n`);
    process.stdout.write(`          ${r.localPath}\n`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'add':
      return addCommand(rest);
    case 'get':
      return getCommand(rest);
    case 'list':
      return listCommand();
    case 'heal':
      return healCommand(rest);
    case 'init':
      return initCommand(rest);
    case 'repos':
      return reposCommand();
    case undefined:
    case '--help':
    case '-h':
      usage();
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      usage();
  }
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
