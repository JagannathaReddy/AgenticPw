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
  test-agent heal <testPath> [--repo <shortId|uuid>] [--page-object <path>] [--include <glob> ...] [--format github]
  test-agent improve <testPath> [--repo <shortId|uuid>] [--page-object <path>]
  test-agent steward [--repo <shortId|uuid>] [--runs N] [--format github]   # suite health report (default 3 runs)
  test-agent batch '<glob>' [--repo <shortId|uuid>] [--max-cost N] [--format github]
  test-agent batch --from-steward <manifestId>             # heal every candidate from a report
  test-agent apply --batch <manifestId>                    # apply all verified patches from a batch
  test-agent apply <manifestId>       # write a verified triage/improve patch onto the original file
  test-agent feedback <manifestId> --up|--down [--note "..."]   # rate a heal (apply records --up for you)
  test-agent feedback --stats                              # accept-rates per category / prompt version
  test-agent get <manifestId>
  test-agent list

  test-agent init <local-path> [--name <name>]
  test-agent repos

  test-agent doctor
  test-agent cost [--since 24h|7d] [--repo <shortId>]

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


/** Resolve --repo, print the standard repo line, return the uuid. */
async function resolveRepoOption(
  ref: string | undefined,
  noProfileNote: string | null = ' — no profile',
): Promise<string | undefined> {
  if (!ref) return undefined;
  const resolved = await resolveRepoRef(ref);
  process.stdout.write(`Repo: ${resolved.name} (${resolved.id.slice(0, 8)})`);
  if (noProfileNote === null) process.stdout.write('\n');
  else process.stdout.write(resolved.hasProfile ? ' — profile ✓\n' : `${noProfileNote}\n`);
  return resolved.id;
}

/** POST a manifest, print its ids, then stream events to terminal state. */
async function submitAndWatch(
  apiPath: string,
  body: Record<string, unknown>,
  watchOpts: WatchOpts = {},
): Promise<void> {
  const submitted = await apiCall<{ manifestId: string; correlationId: string }>(apiPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  process.stdout.write(`  manifestId:    ${submitted.manifestId}\n`);
  process.stdout.write(`  correlationId: ${submitted.correlationId}\n\n`);
  await watchManifest(submitted.manifestId, watchOpts);
}

function describeEvent(kind: string, p: Record<string, unknown>): string {
  const bits: string[] = [];
  const g = <T>(k: string): T | undefined => p[k] as T | undefined;

  const actionCount = g<number>('actionCount');
  if (actionCount !== undefined) bits.push(`${actionCount} actions`);

  const runIndex = g<number>('runIndex');
  const of = g<number>('of');
  if (runIndex !== undefined && of !== undefined) bits.push(`run ${runIndex}/${of}`);
  const totalTests = g<number>('total');
  if (totalTests !== undefined) bits.push(`${totalTests} tests`);

  const index = g<number>('index');
  if (index !== undefined && of !== undefined) bits.push(`${index}/${of}`);
  const testPathBit = g<string>('testPath');
  if (testPathBit && index !== undefined) bits.push(testPathBit);
  const childStatus = g<string>('childStatus');
  if (childStatus) {
    const already = g<boolean>('alreadyPassing');
    bits.push(
      already
        ? '✓ already passing'
        : childStatus === 'succeeded'
          ? '✓ patched'
          : `✗ ${childStatus}`,
    );
  }

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
  if (reason) bits.push(`reason: ${truncateReason(String(reason), 200)}`);

  return bits.join(' · ');
}

/**
 * Truncate `text` to at most `max` chars, breaking on the last whitespace
 * (or hyphen) rather than mid-word. Appends "…" when actually truncated.
 */
function truncateReason(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const slice = flat.slice(0, max);
  const breakAt = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('-'));
  const cut = breakAt > max * 0.6 ? breakAt : max;
  return `${flat.slice(0, cut).trimEnd()}…`;
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
        process.stdout.write(`✓ Triage: patch verified (dry-run — nothing on disk changed)\n`);
        if (r.category) process.stdout.write(`  category: ${String(r.category)}\n`);
        if (r.patchedTestPath)
          process.stdout.write(`  patched:  ${String(r.patchedTestPath)}\n`);
        if (r.originalTestPath)
          process.stdout.write(`  original: ${String(r.originalTestPath)} (unchanged)\n`);
        // Diff is printed by watchManifest right before this — it needs
        // filesystem reads, so we do that async there and pass here via a
        // separate call site. See emitDiffIfAvailable below.
        process.stdout.write('\n');
        process.stdout.write(`Apply the patch:  npm run agent -- apply ${m.id}\n`);
      }
    } else if (role === 'orchestrator' || m.goal?.kind === 'batch_heal') {
      const children = (r.children ?? []) as Array<{
        manifestId: string;
        testPath: string;
        status: string;
        category: string | null;
        patchedTestPath: string | null;
        alreadyPassing: boolean;
      }>;
      process.stdout.write(`✓ Batch complete — ${String(r.patched ?? 0)}/${String(r.total ?? children.length)} patched`);
      if (r.totalSpendUSD !== undefined) process.stdout.write(` · $${String(r.totalSpendUSD)}`);
      process.stdout.write('\n\n');
      for (const c of children) {
        const mark = c.alreadyPassing
          ? '– already passing'
          : c.status === 'succeeded' && c.patchedTestPath
            ? '✓ patched'
            : c.status === 'skipped_budget'
              ? '⏭ skipped (budget)'
              : `✗ ${c.status}${c.category ? ` (${c.category})` : ''}`;
        process.stdout.write(`  ${c.testPath.padEnd(48)} ${mark}\n`);
      }
      if (Number(r.patched ?? 0) > 0) {
        process.stdout.write(`\nApply all verified patches:  npm run agent -- apply --batch ${m.id}\n`);
      }
    } else if (role === 'steward' || m.goal?.kind === 'suite_health') {
      process.stdout.write(`✓ Steward: suite health report ready\n`);
      const n = (k: string) => (r[k] !== undefined ? String(r[k]) : '?');
      process.stdout.write(
        `  ${n('totalTests')} tests × ${n('runs')} runs — ` +
          `${n('healthy')} healthy · ${n('flaky')} flaky · ${n('alwaysFailing')} always-failing · ${n('skipped')} skipped\n`,
      );
      if (r.executiveSummary) {
        process.stdout.write('\n');
        for (const line of String(r.executiveSummary).split('\n')) {
          process.stdout.write(`  ${line}\n`);
        }
      }
      if (r.reportPath) {
        process.stdout.write(`\nFull report:  ${String(r.reportPath)}\n`);
      }
    } else if (role === 'improver' || m.goal?.kind === 'improve_test') {
      process.stdout.write(`✓ Improve: polished spec verified (dry-run — nothing on disk changed)\n`);
      if (r.patchedTestPath)
        process.stdout.write(`  improved: ${String(r.patchedTestPath)}\n`);
      if (r.originalTestPath)
        process.stdout.write(`  original: ${String(r.originalTestPath)} (unchanged)\n`);
      if (r.notes) {
        process.stdout.write(`  notes:\n`);
        for (const line of String(r.notes).split('\n')) {
          process.stdout.write(`    ${line}\n`);
        }
      }
      process.stdout.write('\n');
      process.stdout.write(`Apply the polish:  npm run agent -- apply ${m.id}\n`);
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
    for (const line of String(r.reason).split('\n')) {
      process.stdout.write(`    ${line}\n`);
    }
  }
  process.stdout.write(`\nartifact:  local-artifacts/${m.id}/\n`);
}

async function emitDiffIfTriageSucceeded(m: AnyManifest): Promise<void> {
  const role = m.role ?? m.goal?.kind ?? 'coverage';
  if (m.status !== 'succeeded') return;
  const isTriage = role === 'triage' || m.goal?.kind === 'heal_test';
  const isImprove = role === 'improver' || m.goal?.kind === 'improve_test';
  if (!isTriage && !isImprove) return;
  const r = m.result ?? {};
  if (r.alreadyPassing) return;
  const originalPath = r.originalTestPath as string | undefined;
  const patchedPath = r.patchedTestPath as string | undefined;
  if (!originalPath || !patchedPath) return;

  const fs = await import('node:fs/promises');
  const [orig, patched] = await Promise.all([
    fs.readFile(originalPath, 'utf8').catch(() => ''),
    fs.readFile(patchedPath, 'utf8').catch(() => ''),
  ]);
  if (!orig || !patched) return;

  const { renderUnifiedDiff } = await import('./diff.js');
  const diffText = renderUnifiedDiff(orig, patched, {
    aLabel: originalPath,
    bLabel: patchedPath,
    contextLines: 2,
  });

  process.stdout.write('\nDiff:\n');
  for (const line of diffText.split('\n')) {
    process.stdout.write(`  ${line}\n`);
  }
}

/**
 * Consume the SSE stream of manifest events. Falls back to the old polling
 * loop when SSE isn't supported (older API server).
 */
interface WatchOpts {
  /** Runs on the final manifest before printTerminal/exit (e.g. GH report). */
  onTerminal?: (m: AnyManifest) => Promise<void>;
}

async function watchManifest(id: string, opts: WatchOpts = {}): Promise<void> {
  const startTime = Date.now();
  const url = `${API_BASE}/v1/tests/${id}/events`;

  let res: Response | null = null;
  try {
    res = await fetch(url, { headers: { Accept: 'text/event-stream' } });
  } catch {
    res = null;
  }

  if (!res || !res.ok || !res.body) {
    // Fall through to polling (older server, network hiccup).
    return watchManifestPolling(id, startTime, opts);
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';

  const printEvent = (payload: Record<string, unknown>): void => {
    const kind = String(payload.kind ?? 'event');
    const p = (payload.payload as Record<string, unknown> | undefined) ?? {};
    const stage = (p.stage as string | undefined) ?? '';
    const detail = describeEvent(kind, p);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1).padStart(5);
    const label = stage ? `${kind} · ${stage}` : kind;
    const suffix = detail ? ` — ${detail}` : '';
    process.stdout.write(`  [${elapsed}s] ${label}${suffix}\n`);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE frames: separated by \n\n
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let evName = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) evName = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (evName === 'manifest_event') {
        printEvent(parsed);
      } else if (evName === 'terminal') {
        // Get the full manifest to feed printTerminal + emit diff.
        const m = await apiCall<AnyManifest>(`/v1/tests/${id}`);
        if (opts.onTerminal) await opts.onTerminal(m);
        await emitDiffIfTriageSucceeded(m);
        printTerminal(m);
        process.exit(m.status === 'succeeded' ? 0 : 1);
      }
    }
  }

  // Stream closed without a terminal event — fall through to a final poll
  // so we still print something.
  return watchManifestPolling(id, startTime, opts);
}

/** Legacy polling fallback (also used when SSE fails). */
async function watchManifestPolling(
  id: string,
  startTime = Date.now(),
  opts: WatchOpts = {},
): Promise<void> {
  const seen = new Set<string>();
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
      if (opts.onTerminal) await opts.onTerminal(m);
      await emitDiffIfTriageSucceeded(m);
      printTerminal(m);
      process.exit(m.status === 'succeeded' ? 0 : 1);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function addCommand(argv: string[]): Promise<void> {
  const args = parseAdd(argv);

  const repoId = await resolveRepoOption(args.repoRef, ' — no profile (heuristic will be used)');

  process.stdout.write(`Submitting manifest…\n`);
  process.stdout.write(`  goal:  ${args.goal}\n`);
  process.stdout.write(`  url:   ${args.url}\n`);
  if (args.outcomes.length > 0) {
    process.stdout.write(`  expected outcomes:\n`);
    args.outcomes.forEach((o, i) => process.stdout.write(`    ${i + 1}. ${o}\n`));
  }
  process.stdout.write('\n');

  await submitAndWatch('/v1/tests', {
    goal: args.goal,
    targetUrl: args.url,
    expectedOutcomes: args.outcomes,
    ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
    ...(repoId ? { repoId } : {}),
  });
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

/**
 * Detect --name arguments that look like filesystem paths — a common
 * confusion (issue #9) where a user typed:
 *     test-agent init . --name C:\Users\dev\CodeRepo\Foo
 * intending the path there. Bash then eats the backslashes and the CLI
 * would happily persist "C:UsersdevCodeRepoFoo" as the display label.
 */
function looksLikePath(name: string): boolean {
  return (
    name.includes('/') ||
    name.includes('\\') ||
    /^[A-Za-z]:/.test(name) ||           // Windows drive letter
    /^[A-Za-z]:$/.test(name.slice(0, 2)) // even after bash ate the backslashes
  );
}

/** Slugify a filesystem path segment into a clean display label. */
function slugFromPath(pathValue: string): string {
  const base = pathValue.split(/[/\\]/).pop() ?? pathValue;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repo';
}

async function initCommand(argv: string[]): Promise<void> {
  const args = parseInit(argv);
  const path = await import('node:path');
  const absPath = path.resolve(args.localPath);

  if (args.name && looksLikePath(args.name)) {
    process.stderr.write(
      `\`--name\` is a short display label, not a path.\n` +
        `You passed --name ${JSON.stringify(args.name)} which looks like a filesystem path.\n\n` +
        `Did you mean:\n` +
        `  test-agent init <path> --name <label>\n\n` +
        `Refusing to register a repo with a path-like label. Rerun with a short label\n` +
        `(e.g. --name shop-tests) or omit --name to auto-derive one from the path.\n`,
    );
    process.exit(2);
  }

  const name = args.name ?? slugFromPath(absPath);

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
  includeGlobs: string[];
  format: OutputFormat;
}

type OutputFormat = 'text' | 'github';

function parseFormat(v: string | undefined): OutputFormat {
  if (v === 'github' || v === 'text') return v;
  process.stderr.write(`--format must be 'text' or 'github', got '${v}'\n`);
  process.exit(2);
}

/** Terminal hook that emits annotations + step summary + pr-comment.md. */
function githubTerminalHook(): (m: AnyManifest) => Promise<void> {
  return async (m) => {
    const gh = await import('./gh-format.js');
    const role = m.role ?? m.goal?.kind ?? '';
    if (role === 'steward' || m.goal?.kind === 'suite_health') {
      await gh.emitGithubStewardReport({ id: m.id, status: m.status, result: m.result });
      return;
    }
    const isBatch = role === 'orchestrator' || m.goal?.kind === 'batch_heal';
    const children = isBatch
      ? ((m.result?.children ?? []) as import('./gh-format.js').GhChild[])
      : [gh.triageAsChild(m)];
    await gh.emitGithubReport({ id: m.id, status: m.status, result: m.result }, children);
  };
}

function parseHeal(argv: string[]): HealArgs {
  let testPath = '';
  let pageObjectPath: string | undefined;
  let repoRef: string | undefined;
  let format: OutputFormat = 'text';
  const includeGlobs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repoRef = argv[++i];
    else if (a === '--page-object') pageObjectPath = argv[++i];
    else if (a === '--format') format = parseFormat(argv[++i]);
    else if (a === '--include') {
      const g = argv[++i];
      if (g) includeGlobs.push(g);
    } else if (a === '--help' || a === '-h') usage();
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
  return { testPath, pageObjectPath, repoRef, includeGlobs, format };
}

async function healCommand(argv: string[]): Promise<void> {
  const args = parseHeal(argv);

  const repoId = await resolveRepoOption(args.repoRef);

  process.stdout.write(`Submitting heal manifest…\n`);
  process.stdout.write(`  test:  ${args.testPath}\n`);
  if (args.pageObjectPath) process.stdout.write(`  page:  ${args.pageObjectPath}\n`);
  if (args.includeGlobs.length > 0)
    process.stdout.write(`  include: ${args.includeGlobs.join(', ')}\n`);
  process.stdout.write('\n');

  await submitAndWatch(
    '/v1/heals',
    {
      testPath: args.testPath,
      ...(args.pageObjectPath ? { pageObjectPath: args.pageObjectPath } : {}),
      ...(repoId ? { repoId } : {}),
      ...(args.includeGlobs.length > 0 ? { includeGlobs: args.includeGlobs } : {}),
    },
    args.format === 'github' ? { onTerminal: githubTerminalHook() } : {},
  );
}

async function improveCommand(argv: string[]): Promise<void> {
  const args = parseHeal(argv); // same shape: <testPath> [--repo] [--page-object]

  const repoId = await resolveRepoOption(args.repoRef);

  process.stdout.write(`Submitting improve manifest…\n`);
  process.stdout.write(`  test:  ${args.testPath}\n`);
  if (args.pageObjectPath) process.stdout.write(`  page:  ${args.pageObjectPath}\n`);
  process.stdout.write('\n');

  await submitAndWatch('/v1/improves', {
    testPath: args.testPath,
    ...(args.pageObjectPath ? { pageObjectPath: args.pageObjectPath } : {}),
    ...(repoId ? { repoId } : {}),
  });
}

async function stewardCommand(argv: string[]): Promise<void> {
  let repoRef: string | undefined;
  let runs: number | undefined;
  let format: OutputFormat = 'text';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repoRef = argv[++i];
    else if (a === '--runs') runs = Number(argv[++i]);
    else if (a === '--format') format = parseFormat(argv[++i]);
    else if (a === '--help' || a === '-h') usage();
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      usage();
    }
  }
  if (runs !== undefined && (!Number.isInteger(runs) || runs < 1 || runs > 10)) {
    process.stderr.write(`--runs must be an integer between 1 and 10\n`);
    process.exit(2);
  }

  const repoId = await resolveRepoOption(repoRef, null);

  process.stdout.write(`Submitting steward manifest (${runs ?? 3} full-suite runs)…\n\n`);

  await submitAndWatch(
    '/v1/stewards',
    {
      ...(repoId ? { repoId } : {}),
      ...(runs !== undefined ? { runs } : {}),
    },
    format === 'github' ? { onTerminal: githubTerminalHook() } : {},
  );
}

/** Copy one manifest's verified patch onto the original files. */
/**
 * Applying a patch is the strongest "this heal was right" signal we get
 * without asking. Record it as an implicit thumbs-up — best-effort: a
 * feedback failure must never fail the apply, and only triage manifests
 * take feedback (improve manifests would 422).
 */
async function recordApplyFeedback(m: AnyManifest, opts: { quiet?: boolean }): Promise<void> {
  const role = m.role ?? '';
  if (!(role === 'triage' || m.goal?.kind === 'heal_test')) return;
  try {
    const res = await fetch(`${API_BASE}/v1/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifestId: m.id, verdict: 'up', source: 'apply' }),
    });
    if (res.ok && !opts.quiet) {
      const body = (await res.json()) as { created?: boolean };
      if (body.created) {
        process.stdout.write(
          `✓ recorded thumbs-up (wrong? test-agent feedback ${m.id.slice(0, 8)} --down --note "...")\n`,
        );
      }
    }
  } catch {
    /* feedback is a side-channel; the apply already succeeded */
  }
}

async function applyOne(m: AnyManifest, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const id = m.id;
  if (m.status !== 'succeeded') {
    process.stderr.write(`Manifest ${id.slice(0, 8)} is ${m.status}, nothing to apply.\n`);
    return false;
  }
  const r = m.result ?? {};
  const originalTestPath = r.originalTestPath as string | undefined;
  const patchedTestPath = r.patchedTestPath as string | undefined;
  const patchedPageObjectPath = r.patchedPageObjectPath as string | undefined;
  if (!originalTestPath || !patchedTestPath) {
    if (!opts.quiet)
      process.stderr.write(`Manifest ${id.slice(0, 8)} has no patched files (may be alreadyPassing).\n`);
    return false;
  }

  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  // Copy patched test on top of the original the user passed to heal.
  await fs.copyFile(patchedTestPath, originalTestPath);
  process.stdout.write(`✓ overwrote ${originalTestPath}\n`);

  // Copy the patched page object too if it exists and we know the original.
  if (patchedPageObjectPath) {
    // The heal input recorded the page object it read from (if any). Fall
    // back to the sibling ./pages/<same basename> next to the original.
    const originalPage =
      ((m.goal?.params ?? {}) as { pageObjectPath?: string }).pageObjectPath ??
      path.join(
        path.dirname(originalTestPath),
        'pages',
        path.basename(patchedPageObjectPath),
      );
    try {
      await fs.copyFile(patchedPageObjectPath, originalPage);
      process.stdout.write(`✓ overwrote ${originalPage}\n`);
    } catch (err) {
      process.stdout.write(
        `⚠ could not overwrite page object at ${originalPage}: ${(err as Error).message}\n`,
      );
    }
  }
  await recordApplyFeedback(m, opts);
  return true;
}

async function applyCommand(argv: string[]): Promise<void> {
  let id = '';
  let batchId = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--batch') batchId = argv[++i] ?? '';
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('-')) {
      process.stderr.write(`Unknown flag: ${a}\n`);
      usage();
    } else if (!id) id = a;
  }

  if (batchId) {
    const parent = await apiCall<AnyManifest>(`/v1/tests/${batchId}`);
    const role = parent.role ?? parent.goal?.kind ?? '';
    if (!(role === 'orchestrator' || parent.goal?.kind === 'batch_heal')) {
      process.stderr.write(`Manifest ${batchId.slice(0, 8)} is not a batch (role=${role}).\n`);
      process.exit(2);
    }
    const children = ((parent.result?.children ?? []) as Array<{
      manifestId: string;
      testPath: string;
      status: string;
      patchedTestPath: string | null;
    }>).filter((c) => c.status === 'succeeded' && c.patchedTestPath && c.manifestId);
    if (children.length === 0) {
      process.stderr.write('Batch has no verified patches to apply.\n');
      process.exit(1);
    }
    let applied = 0;
    for (const c of children) {
      const child = await apiCall<AnyManifest>(`/v1/tests/${c.manifestId}`);
      if (await applyOne(child, { quiet: true })) applied++;
    }
    process.stdout.write(`\n${applied}/${children.length} patches applied.\n`);
    process.stdout.write('Run: npx playwright test\n');
    return;
  }

  if (!id) {
    process.stderr.write('Manifest id required. See recent runs with: test-agent list\n');
    process.exit(2);
  }
  const m = await apiCall<AnyManifest>(`/v1/tests/${id}`);
  const role = m.role ?? m.goal?.kind ?? '';
  const isTriage = role === 'triage' || m.goal?.kind === 'heal_test';
  const isImprove = role === 'improver' || m.goal?.kind === 'improve_test';
  if (!isTriage && !isImprove) {
    process.stderr.write(
      `Manifest ${id.slice(0, 8)} is role=${role}; apply only works on triage/improve manifests (or --batch <id>).\n`,
    );
    process.exit(2);
  }
  const ok = await applyOne(m);
  if (!ok) process.exit(1);
  const originalTestPath = (m.result ?? {}).originalTestPath as string | undefined;
  if (originalTestPath) process.stdout.write('\nRun: npx playwright test ' + originalTestPath + '\n');
}

interface FeedbackStats {
  byCategory: Array<{ category: string; ups: number; downs: number; total: number }>;
  byPrompt: Array<{
    prompt_hash: string;
    prompt_file: string;
    model: string;
    ups: number;
    downs: number;
    total: number;
  }>;
  recent: Array<{
    manifest_id: string;
    verdict: string;
    source: string;
    category: string | null;
    test_path: string | null;
    note: string | null;
    created_at: string;
  }>;
}

async function feedbackCommand(argv: string[]): Promise<void> {
  let id = '';
  let verdict: 'up' | 'down' | '' = '';
  let note: string | undefined;
  let stats = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--up') verdict = 'up';
    else if (a === '--down') verdict = 'down';
    else if (a === '--note') note = argv[++i];
    else if (a === '--stats') stats = true;
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('-')) {
      process.stderr.write(`Unknown flag: ${a}\n`);
      usage();
    } else if (!id) id = a;
  }

  if (stats) {
    const s = await apiCall<FeedbackStats>('/v1/feedback/stats');
    if (s.byCategory.length === 0) {
      process.stdout.write(
        '(no feedback yet — `test-agent apply` records it, or use `test-agent feedback <id> --up|--down`)\n',
      );
      return;
    }
    const rate = (ups: number, total: number) =>
      total === 0 ? '   —' : `${String(Math.round((100 * ups) / total)).padStart(3)}%`;

    process.stdout.write('Accept-rate by failure category\n');
    process.stdout.write('  category            👍    👎   accept\n');
    for (const r of s.byCategory) {
      process.stdout.write(
        `  ${r.category.padEnd(18)} ${String(r.ups).padStart(3)}  ${String(r.downs).padStart(4)}   ${rate(r.ups, r.total)}\n`,
      );
    }

    process.stdout.write('\nBy healer prompt version × model\n');
    process.stdout.write('  prompt              hash          model                👍    👎   accept\n');
    for (const r of s.byPrompt) {
      process.stdout.write(
        `  ${r.prompt_file.padEnd(18)}  ${r.prompt_hash.slice(0, 12).padEnd(12)}  ${r.model.padEnd(18)} ${String(r.ups).padStart(3)}  ${String(r.downs).padStart(4)}   ${rate(r.ups, r.total)}\n`,
      );
    }

    process.stdout.write('\nRecent\n');
    for (const r of s.recent) {
      const mark = r.verdict === 'up' ? '👍' : '👎';
      const via = r.source === 'apply' ? 'via apply' : 'explicit';
      const noteStr = r.note ? ` — "${r.note}"` : '';
      process.stdout.write(
        `  ${mark} ${r.manifest_id.slice(0, 8)}  ${(r.category ?? '?').padEnd(16)} ${(r.test_path ?? '').padEnd(36)} ${via}${noteStr}\n`,
      );
    }
    return;
  }

  if (!id || !verdict) {
    process.stderr.write(
      'Usage: test-agent feedback <manifestId> --up|--down [--note "..."]  (or --stats)\n',
    );
    process.exit(2);
  }

  const created = await apiCall<{ id: string; category: string | null }>('/v1/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifestId: id, verdict, ...(note ? { note } : {}) }),
  });
  const mark = verdict === 'up' ? '👍' : '👎';
  process.stdout.write(
    `${mark} recorded for ${id.slice(0, 8)}${created.category ? ` (${created.category})` : ''}` +
      `${note ? ` — "${note}"` : ''}\n`,
  );
  if (verdict === 'down' && !note) {
    process.stdout.write(
      '  Tip: a --note explains the miss to the healer on future runs — it is worth 10 bare thumbs.\n',
    );
  }
}

async function batchCommand(argv: string[]): Promise<void> {
  let globArg = '';
  let fromSteward = '';
  let repoRef: string | undefined;
  let maxCost: number | undefined;
  let format: OutputFormat = 'text';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from-steward') fromSteward = argv[++i] ?? '';
    else if (a === '--repo') repoRef = argv[++i];
    else if (a === '--max-cost') maxCost = Number(argv[++i]);
    else if (a === '--format') format = parseFormat(argv[++i]);
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('-')) {
      process.stderr.write(`Unknown flag: ${a}\n`);
      usage();
    } else if (!globArg) globArg = a;
  }
  if (!globArg && !fromSteward) {
    process.stderr.write(`Give a spec glob or --from-steward <manifestId>.\n`);
    usage();
  }
  if (maxCost !== undefined && (!Number.isFinite(maxCost) || maxCost <= 0)) {
    process.stderr.write(`--max-cost must be a positive number (USD)\n`);
    process.exit(2);
  }

  const repoId = await resolveRepoOption(repoRef, null);

  process.stdout.write(`Submitting batch heal…\n`);
  if (fromSteward) process.stdout.write(`  from steward report: ${fromSteward.slice(0, 8)}\n`);
  if (globArg) process.stdout.write(`  glob: ${globArg}\n`);
  process.stdout.write('\n');

  const submitted = await apiCall<{ manifestId: string; specCount: number }>('/v1/batches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(fromSteward ? { fromManifestId: fromSteward } : {}),
      ...(globArg ? { glob: globArg } : {}),
      ...(repoId ? { repoId } : {}),
      ...(maxCost !== undefined ? { maxCostUSD: maxCost } : {}),
    }),
  });

  process.stdout.write(`  manifestId: ${submitted.manifestId}\n`);
  if (submitted.specCount > 0) process.stdout.write(`  specs:      ${submitted.specCount}\n`);
  process.stdout.write('\n');

  await watchManifest(
    submitted.manifestId,
    format === 'github' ? { onTerminal: githubTerminalHook() } : {},
  );
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
    case 'improve':
      return improveCommand(rest);
    case 'steward':
      return stewardCommand(rest);
    case 'batch':
      return batchCommand(rest);
    case 'apply':
      return applyCommand(rest);
    case 'feedback':
      return feedbackCommand(rest);
    case 'init':
      return initCommand(rest);
    case 'repos':
      return reposCommand();
    case 'doctor': {
      const { runDoctor } = await import('./doctor.js');
      const code = await runDoctor();
      process.exit(code);
    }
    case 'cost': {
      const { runCost } = await import('./cost.js');
      const code = await runCost(rest);
      process.exit(code);
    }
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
