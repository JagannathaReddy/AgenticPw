import type pg from 'pg';
import { withTenant, type Tenant } from '../db.js';

/**
 * A.1 analyzer — pure clusterer over recent rejected manifests.
 *
 * Reads manifests + LLM cost inside the tenant, groups them by
 * (category, first-line reason signature), and emits a Markdown report.
 * Deterministic — no LLM. A.2 will layer LLM hypothesis generation on top
 * of the clusters this produces.
 *
 * The point isn't to be clever about signatures. A dumb-but-stable key
 * makes the report reproducible across runs; the interesting work is
 * A.2 (proposals) and A.3 (eval scoring).
 */

export interface AnalyzeInput {
  sinceHours: number;
  /** Optional role filter, e.g. 'triage' | 'coverage'. Undefined = all. */
  roleFilter?: string | null;
  /** Only report clusters with at least this many manifests. Default 2. */
  minClusterSize?: number;
  /** Cap manifests inspected per run so a huge window can't OOM. */
  maxRows?: number;
}

export interface ManifestSample {
  id: string;
  role: string;
  category: string;
  reasonHead: string;
  costUSD: number;
  createdAt: string;
  repoName: string | null;
}

export interface Cluster {
  key: string;
  category: string;
  signature: string;
  count: number;
  totalCostUSD: number;
  avgCostUSD: number;
  sampleIds: string[];
  roles: string[];
  repos: string[];
}

export interface AnalyzeResult {
  window: { sinceHours: number; from: string; to: string };
  roleFilter: string | null;
  rejectedTotal: number;
  totalWastedUSD: number;
  clusters: Cluster[];
  markdown: string;
}

const REASON_HEAD_MAX = 120;

/**
 * Extract a stable, human-readable signature from a rejection reason.
 * We take the first meaningful sentence, drop stack line/column noise
 * ("at foo.ts:123:45"), and cap length so cluster keys stay tight.
 */
export function reasonSignature(reason: string): string {
  if (!reason) return '(no reason)';
  const firstLine = reason.split(/\r?\n/)[0] ?? '';
  const noStackCoords = firstLine.replace(/:\d+(:\d+)?/g, '');
  const noUuids = noStackCoords.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    '<uuid>',
  );
  const shortIds = noUuids.replace(/\b[0-9a-f]{7,}\b/gi, '<hex>');
  const trimmed = shortIds.trim();
  return trimmed.length > REASON_HEAD_MAX
    ? trimmed.slice(0, REASON_HEAD_MAX) + '…'
    : trimmed;
}

export async function analyzeManifests(
  input: AnalyzeInput,
  pool: pg.Pool,
  tenant: Tenant,
): Promise<AnalyzeResult> {
  const sinceHours = Math.max(1, Math.trunc(input.sinceHours));
  const roleFilter = input.roleFilter ?? null;
  const minClusterSize = Math.max(1, input.minClusterSize ?? 2);
  const maxRows = Math.min(1000, Math.max(10, input.maxRows ?? 200));

  const rows = await withTenant(pool, tenant, async (client) => {
    const result = await client.query<{
      id: string;
      role: string;
      created_at: string;
      category: string | null;
      reason: string | null;
      cost: string | null;
      repo_name: string | null;
    }>(
      `SELECT m.id, m.role, m.created_at,
              m.result->>'category' AS category,
              m.result->>'reason'   AS reason,
              COALESCE((SELECT SUM(cost_usd) FROM llm_calls WHERE manifest_id = m.id), 0)::text AS cost,
              r.full_name AS repo_name
         FROM manifests m
         LEFT JOIN repositories r
           ON r.id = (m.goal->'params'->>'repoId')::uuid
        WHERE m.status = 'rejected'
          AND m.created_at > now() - ($1::int || ' hours')::interval
          AND ($2::text IS NULL OR m.role = $2)
        ORDER BY m.created_at DESC
        LIMIT $3`,
      [sinceHours, roleFilter, maxRows],
    );
    return result.rows;
  });

  const samples: ManifestSample[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    category: r.category ?? 'unknown',
    reasonHead: reasonSignature(r.reason ?? ''),
    costUSD: Number(r.cost ?? '0'),
    createdAt: r.created_at,
    repoName: r.repo_name,
  }));

  const byKey = new Map<string, ManifestSample[]>();
  for (const s of samples) {
    const key = `${s.category}::${s.reasonHead}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(s);
    else byKey.set(key, [s]);
  }

  const clusters: Cluster[] = [...byKey.entries()]
    .filter(([, list]) => list.length >= minClusterSize)
    .map(([key, list]) => {
      const totalCostUSD = list.reduce((sum, s) => sum + s.costUSD, 0);
      const roles = [...new Set(list.map((s) => s.role))];
      const repos = [...new Set(list.map((s) => s.repoName).filter((r): r is string => !!r))];
      return {
        key,
        category: list[0].category,
        signature: list[0].reasonHead,
        count: list.length,
        totalCostUSD: Number(totalCostUSD.toFixed(4)),
        avgCostUSD: Number((totalCostUSD / list.length).toFixed(4)),
        sampleIds: list.slice(0, 5).map((s) => s.id),
        roles,
        repos,
      };
    })
    .sort((a, b) => b.count - a.count || b.totalCostUSD - a.totalCostUSD);

  const totalWastedUSD = Number(
    samples.reduce((sum, s) => sum + s.costUSD, 0).toFixed(4),
  );

  const now = new Date();
  const from = new Date(now.getTime() - sinceHours * 3600 * 1000);

  const markdown = renderMarkdown({
    window: { sinceHours, from: from.toISOString(), to: now.toISOString() },
    roleFilter,
    rejectedTotal: samples.length,
    totalWastedUSD,
    clusters,
  });

  return {
    window: { sinceHours, from: from.toISOString(), to: now.toISOString() },
    roleFilter,
    rejectedTotal: samples.length,
    totalWastedUSD,
    clusters,
    markdown,
  };
}

function renderMarkdown(r: Omit<AnalyzeResult, 'markdown'>): string {
  const lines: string[] = [];
  lines.push('# Analyzer report');
  lines.push('');
  lines.push(
    `**Window:** last ${r.window.sinceHours}h · **Role filter:** ${r.roleFilter ?? 'all'} · **Rejected manifests:** ${r.rejectedTotal} · **LLM cost of rejections:** $${r.totalWastedUSD.toFixed(4)}`,
  );
  lines.push('');
  if (r.clusters.length === 0) {
    lines.push('No clusters at or above the sample threshold. Either the platform is behaving, the window is too narrow, or your rejections are too heterogeneous to pattern-match.');
    return lines.join('\n');
  }
  lines.push('## Top patterns');
  lines.push('');
  r.clusters.forEach((c, i) => {
    lines.push(
      `### ${i + 1}. ${c.category} — ${c.count} manifests · $${c.totalCostUSD.toFixed(4)} wasted`,
    );
    lines.push('');
    lines.push(`- **Signature:** ${c.signature}`);
    lines.push(`- **Roles:** ${c.roles.join(', ')}`);
    if (c.repos.length) lines.push(`- **Repos:** ${c.repos.join(', ')}`);
    lines.push(`- **Avg cost per attempt:** $${c.avgCostUSD.toFixed(4)}`);
    lines.push(`- **Sample manifest IDs:** ${c.sampleIds.join(', ')}`);
    lines.push('');
  });
  lines.push('---');
  lines.push('');
  lines.push('_A.2 will turn each cluster into a concrete change proposal (prompt edit, denylist addition, or retry-context tweak) with evidence and eval-corpus scoring._');
  return lines.join('\n');
}
