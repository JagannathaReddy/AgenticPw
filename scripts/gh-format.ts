/**
 * GitHub Actions output for heal results (#18).
 *
 * Three surfaces, all suggestions-only (the Action never pushes):
 *   1. Workflow-command annotations (::notice / ::warning / ::error)
 *   2. $GITHUB_STEP_SUMMARY markdown (job summary tab)
 *   3. pr-comment.md — a comment body with <details> diff blocks the
 *      workflow can post on the PR
 *
 * Used by `test-agent batch --format github` and `heal --format github`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderUnifiedDiff } from './diff.js';

export interface GhChild {
  manifestId: string;
  testPath: string;
  status: string;
  category: string | null;
  patchedTestPath: string | null;
  patchedPageObjectPath?: string | null;
  alreadyPassing?: boolean;
  message?: string;
}

interface GhParent {
  id: string;
  status: string;
  result?: Record<string, unknown>;
}

/** Workflow-command messages must escape %, CR, LF. */
function esc(msg: string): string {
  return msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Refusal messages can carry raw Playwright JSON tails — keep the gist. */
function brief(msg: string | undefined): string {
  if (!msg) return '';
  return msg.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 200);
}

function outcomeLabel(c: GhChild): string {
  if (c.status === 'succeeded' && c.alreadyPassing) return '✓ already passing';
  if (c.status === 'succeeded') return '✓ patched';
  if (c.status === 'skipped_budget') return '⏭ skipped (budget)';
  return `✗ ${c.status}`;
}

function annotationFor(c: GhChild): string {
  if (c.status === 'succeeded' && !c.alreadyPassing) {
    return `::notice file=${c.testPath}::test-agent patched this spec (${c.category ?? 'unknown'}) — dry-run, see the PR comment for the diff`;
  }
  if (c.status === 'succeeded') {
    return `::notice file=${c.testPath}::already passing — nothing to heal`;
  }
  if (c.status === 'skipped_budget') {
    return `::warning file=${c.testPath}::heal skipped: batch cost cap reached`;
  }
  if (c.status === 'rejected') {
    return `::warning file=${c.testPath}::heal refused (${c.category ?? 'unknown'}): ${esc(brief(c.message))}`;
  }
  return `::error file=${c.testPath}::heal failed: ${esc(brief(c.message) || c.status)}`;
}

function summaryMarkdown(parent: GhParent, children: GhChild[]): string {
  const patched = children.filter((c) => c.status === 'succeeded' && !c.alreadyPassing).length;
  const spend = Number(parent.result?.totalSpendUSD ?? 0);
  const lines = [
    `## 🤖 test-agent heal — ${patched}/${children.length} patched`,
    '',
    `Dry-run: nothing was pushed. Spend: $${spend.toFixed(4)} · batch \`${parent.id.slice(0, 8)}\``,
    '',
    '| spec | outcome | category |',
    '|------|---------|----------|',
    ...children.map(
      (c) => `| \`${c.testPath}\` | ${outcomeLabel(c)} | ${c.category ?? '—'} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

async function plainDiff(aPath: string, bPath: string): Promise<string | null> {
  try {
    const [orig, patched] = await Promise.all([
      fs.readFile(aPath, 'utf8'),
      fs.readFile(bPath, 'utf8'),
    ]);
    if (orig === patched) return null;
    // NO_COLOR: comment bodies must be plain even when stdout is a TTY.
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const text = renderUnifiedDiff(orig, patched, {
      aLabel: aPath,
      bLabel: bPath,
      contextLines: 2,
    });
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
    return text;
  } catch {
    return null;
  }
}

/**
 * Diff spec + page object against their originals. The original POM path is
 * the same guess `agent apply` uses: sibling pages/<basename> next to the
 * spec.
 */
async function diffsFor(c: GhChild): Promise<string[]> {
  const out: string[] = [];
  if (c.patchedTestPath) {
    const d = await plainDiff(c.testPath, c.patchedTestPath);
    if (d) out.push(d);
  }
  if (c.patchedPageObjectPath) {
    const originalPage = path.join(
      path.dirname(c.testPath),
      'pages',
      path.basename(c.patchedPageObjectPath),
    );
    const d = await plainDiff(originalPage, c.patchedPageObjectPath);
    if (d) out.push(d);
  }
  return out;
}

async function commentMarkdown(parent: GhParent, children: GhChild[]): Promise<string> {
  const patched = children.filter((c) => c.status === 'succeeded' && !c.alreadyPassing);
  const refused = children.filter((c) => c.status === 'rejected');
  const failed = children.filter((c) => c.status === 'failed');
  const skipped = children.filter((c) => c.status === 'skipped_budget');
  const spend = Number(parent.result?.totalSpendUSD ?? 0);

  const out: string[] = [
    `### 🤖 test-agent suggested ${patched.length} ${patched.length === 1 ? 'patch' : 'patches'} (dry-run)`,
    '',
    `Every patch below was verified green by Playwright before being suggested. ` +
      `Nothing was pushed — apply locally with \`npm run agent -- apply --batch ${parent.id}\`. ` +
      `Spend: $${spend.toFixed(4)}.`,
    '',
  ];

  for (const c of patched) {
    out.push('<details>');
    out.push(`<summary><code>${c.testPath}</code> (${c.category ?? 'unknown'}) — verified ✓</summary>`);
    out.push('');
    const diffs = await diffsFor(c);
    if (diffs.length > 0) {
      for (const diff of diffs) {
        out.push('```diff');
        out.push(diff);
        out.push('```');
      }
    } else {
      out.push(`_Diff unavailable on this runner — patched file: \`${c.patchedTestPath}\`._`);
    }
    out.push('');
    out.push(`Apply just this one: \`npm run agent -- apply ${c.manifestId}\``);
    out.push('</details>');
    out.push('');
  }

  if (refused.length > 0) {
    out.push(`#### Refused to heal (${refused.length}) — human decision needed`);
    out.push('');
    for (const c of refused) {
      out.push(`- \`${c.testPath}\` — **${c.category ?? 'unknown'}**: ${brief(c.message)}`);
    }
    out.push('');
  }
  if (failed.length > 0) {
    out.push(`#### Failed (${failed.length})`);
    out.push('');
    for (const c of failed) out.push(`- \`${c.testPath}\` — ${brief(c.message) || 'failed'}`);
    out.push('');
  }
  if (skipped.length > 0) {
    out.push(`_${skipped.length} spec(s) skipped: batch cost cap reached._`);
    out.push('');
  }

  out.push('---');
  out.push('_Suggestions only — test-agent never pushes to your branch. See docs/guides/SECURITY-CI.md._');
  return out.join('\n');
}

async function appendFileIfSet(envVar: string, content: string): Promise<void> {
  const target = process.env[envVar];
  if (!target) return;
  await fs.appendFile(target, content + '\n');
}

/**
 * Emit all three surfaces for a finished batch (or single-heal wrapped as a
 * one-child batch). Returns the comment file path.
 */
export async function emitGithubReport(
  parent: GhParent,
  children: GhChild[],
  artifactsDir = 'local-artifacts',
): Promise<string> {
  for (const c of children) {
    process.stdout.write(annotationFor(c) + '\n');
  }

  await appendFileIfSet('GITHUB_STEP_SUMMARY', summaryMarkdown(parent, children));

  const comment = await commentMarkdown(parent, children);
  const commentPath = path.join(artifactsDir, parent.id, 'pr-comment.md');
  await fs.mkdir(path.dirname(commentPath), { recursive: true });
  await fs.writeFile(commentPath, comment);

  const patched = children.filter((c) => c.status === 'succeeded' && !c.alreadyPassing).length;
  await appendFileIfSet(
    'GITHUB_OUTPUT',
    [`comment-path=${commentPath}`, `patched=${patched}`, `total=${children.length}`].join('\n'),
  );

  process.stdout.write(`\ncomment-file: ${commentPath}\n`);
  return commentPath;
}

interface StewardResult {
  runs?: number;
  totalTests?: number;
  healthy?: number;
  flaky?: number;
  alwaysFailing?: number;
  skipped?: number;
  healCandidates?: string[] | null;
  trends?: {
    previousAt?: string;
    newProblems?: string[];
    fixed?: string[];
    stillBroken?: string[];
  } | null;
  executiveSummary?: string;
  reportPath?: string;
}

/**
 * Steward variant (#Sprint 4): suite-health report into the job summary,
 * warnings pinned to heal-candidate files, and outputs a follow-up
 * workflow can chain into `agent batch --from-steward`.
 */
export async function emitGithubStewardReport(m: {
  id: string;
  status: string;
  result?: Record<string, unknown>;
}): Promise<void> {
  const r = (m.result ?? {}) as StewardResult;
  const candidates = r.healCandidates ?? [];

  for (const file of candidates) {
    process.stdout.write(
      `::warning file=${file}::always failing with a healable category — ` +
        `run: agent batch --from-steward ${m.id}\n`,
    );
  }

  const lines: string[] = [
    `## 🩺 Suite health — ${r.healthy ?? 0}/${r.totalTests ?? 0} healthy`,
    '',
    `${r.runs ?? '?'} full-suite runs · steward \`${m.id.slice(0, 8)}\``,
    '',
    '| verdict | count |',
    '|---------|-------|',
    `| ✅ healthy | ${r.healthy ?? 0} |`,
    `| 🎲 flaky | ${r.flaky ?? 0} |`,
    `| ❌ always failing | ${r.alwaysFailing ?? 0} |`,
    `| ⏭ skipped | ${r.skipped ?? 0} |`,
    '',
  ];
  if (r.executiveSummary) {
    lines.push(r.executiveSummary.trim(), '');
  }
  if (candidates.length > 0) {
    lines.push(`### Heal candidates (${candidates.length})`, '');
    for (const f of candidates) lines.push(`- \`${f}\``);
    lines.push('', `Heal them all: \`npm run agent -- batch --from-steward ${m.id}\``, '');
  }
  const t = r.trends;
  if (t && ((t.newProblems?.length ?? 0) + (t.fixed?.length ?? 0) + (t.stillBroken?.length ?? 0) > 0)) {
    lines.push(`### Since last report${t.previousAt ? ` (${t.previousAt.slice(0, 10)})` : ''}`, '');
    if (t.fixed?.length) lines.push(`- ✅ Fixed (${t.fixed.length}): ${t.fixed.join(', ')}`);
    if (t.newProblems?.length) lines.push(`- 🆕 Broken (${t.newProblems.length}): ${t.newProblems.join(', ')}`);
    if (t.stillBroken?.length) lines.push(`- ⏳ Still broken (${t.stillBroken.length}): ${t.stillBroken.join(', ')}`);
    lines.push('');
  }
  await appendFileIfSet('GITHUB_STEP_SUMMARY', lines.join('\n'));

  await appendFileIfSet(
    'GITHUB_OUTPUT',
    [
      `steward-id=${m.id}`,
      `heal-candidates=${candidates.length}`,
      `report-path=${r.reportPath ?? ''}`,
    ].join('\n'),
  );
}

/** Adapt a single triage manifest to the one-child shape. */
export function triageAsChild(m: {
  id: string;
  status: string;
  result?: Record<string, unknown>;
  goal?: { params?: Record<string, unknown> };
}): GhChild {
  const r = m.result ?? {};
  return {
    manifestId: m.id,
    testPath:
      (r.originalTestPath as string | undefined) ??
      ((m.goal?.params ?? {}) as { testPath?: string }).testPath ??
      '(unknown)',
    status: m.status,
    category: (r.category as string | null | undefined) ?? null,
    patchedTestPath: (r.patchedTestPath as string | null | undefined) ?? null,
    patchedPageObjectPath:
      (r.patchedPageObjectPath as string | null | undefined) ?? null,
    alreadyPassing: Boolean(r.alreadyPassing),
    message: (r.reason as string | undefined) ?? undefined,
  };
}
