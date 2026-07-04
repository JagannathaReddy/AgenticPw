import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { expandIncludeGlobs } from '../activities/stack-sources.js';
import { withTenant } from '../db.js';
import { manifestLogger } from '../logger.js';
import { runTriage, type TriageManifestRow } from './triage.js';

/**
 * BatchWorkflow (#14) — heal many specs under one parent manifest.
 *
 * The worker is single-threaded, so the orchestrator does NOT enqueue
 * children for the poll loop (that would deadlock: the loop is busy running
 * the orchestrator). Instead it inserts each child triage manifest row
 * itself — real rows, so SSE / `agent get` / cost metering all work — and
 * runs them inline, sequentially, checking the batch budget between
 * children.
 */

export interface BatchManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      repoId?: string | null;
      specs?: string[] | null;
      glob?: string | null;
    };
  };
  budget: { maxCostUSD?: number };
  audit: { correlationId: string };
}

export interface BatchDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

const MAX_CHILDREN = 25;
const DEFAULT_MAX_COST_USD = 5;

export interface BatchChildOutcome {
  manifestId: string;
  testPath: string;
  status: 'succeeded' | 'rejected' | 'failed' | 'skipped_budget';
  category: string | null;
  patchedTestPath: string | null;
  alreadyPassing: boolean;
  message: string;
}

async function loadRepoRoot(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  fallback: string,
  repoId: string | null | undefined,
): Promise<string> {
  if (!repoId) return fallback;
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{ local_path: string | null }>(
      `SELECT local_path FROM repositories WHERE id = $1`,
      [repoId],
    );
    return rows[0]?.local_path ?? fallback;
  });
}

async function childrenSpendUSD(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  childIds: string[],
): Promise<number> {
  if (childIds.length === 0) return 0;
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{ total: string | null }>(
      `SELECT SUM(cost_usd) AS total FROM llm_calls WHERE manifest_id = ANY($1::uuid[])`,
      [childIds],
    );
    return Number(rows[0]?.total ?? 0);
  });
}

export async function runBatch(
  manifest: BatchManifestRow,
  deps: BatchDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const { repoId, specs: rawSpecs, glob } = manifest.goal.params;
  const maxCostUSD = manifest.budget?.maxCostUSD ?? DEFAULT_MAX_COST_USD;

  const repoRoot = await loadRepoRoot(deps.pool, tenant, deps.config.repoRoot, repoId ?? null);

  // Resolve the spec list: explicit list wins; otherwise expand the glob
  // against the repo root.
  let specs = (rawSpecs ?? []).filter((s) => s.trim().length > 0);
  if (specs.length === 0 && glob) {
    specs = (await expandIncludeGlobs(repoRoot, [glob])).filter((p) =>
      /\.spec\.[tj]sx?$/.test(p),
    );
  }
  specs = Array.from(new Set(specs)).slice(0, MAX_CHILDREN);

  await withTenant(deps.pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = 'in_progress', started_at = now() WHERE id = $1`,
      [manifest.id],
    );
    await appendEvent(client, manifest, 'progress', 'assigned', 'in_progress', {
      stage: 'started',
      workflow: 'batch',
      specCount: specs.length,
      specs,
      maxCostUSD,
    });
  });
  log.info({ stage: 'started', specCount: specs.length, maxCostUSD }, 'Batch started');

  if (specs.length === 0) {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: 'empty_batch',
      reason: glob
        ? `Glob "${glob}" matched no .spec files under ${repoRoot}.`
        : 'No specs given. Pass specs[], a glob, or --from-steward a report with heal candidates.',
    });
  }

  const children: BatchChildOutcome[] = [];
  const childIds: string[] = [];

  for (let i = 0; i < specs.length; i++) {
    const testPath = specs[i];

    // Budget gate BEFORE each child — a heal costs ~$0.002 but a pathological
    // prompt on a big spec can be 100×. Skip remaining children once tripped.
    const spent = await childrenSpendUSD(deps.pool, tenant, childIds);
    if (spent >= maxCostUSD) {
      log.warn({ stage: 'budget', spent, maxCostUSD }, 'Batch budget exhausted; skipping rest');
      for (const rest of specs.slice(i)) {
        children.push({
          manifestId: '',
          testPath: rest,
          status: 'skipped_budget',
          category: null,
          patchedTestPath: null,
          alreadyPassing: false,
          message: `Skipped: batch spend $${spent.toFixed(4)} ≥ cap $${maxCostUSD}`,
        });
      }
      break;
    }

    // Insert a real child triage manifest so events, cost rows, and
    // `agent get/apply` address it like any other heal.
    const childId = randomUUID();
    const childCorrelation = randomUUID();
    const childGoal = {
      kind: 'heal_test' as const,
      description: `Triage failing test ${testPath} (batch ${manifest.id.slice(0, 8)}, ${i + 1}/${specs.length})`,
      params: { testPath, pageObjectPath: null, repoId: repoId ?? null },
    };
    await withTenant(deps.pool, tenant, async (client) => {
      await client.query(
        `INSERT INTO manifests (
           id, org_id, workspace_id, parent_manifest_id, role, status, workflow_id,
           goal, context, budget, success_gate, policy, audit
         )
         SELECT $1, org_id, workspace_id, $2, 'triage', 'assigned', $3,
                $4, context, budget, success_gate, policy, $5
           FROM manifests WHERE id = $2`,
        [
          childId,
          manifest.id,
          `local-${childId}`,
          JSON.stringify(childGoal),
          JSON.stringify({ correlationId: childCorrelation }),
        ],
      );
    });
    childIds.push(childId);

    const childRow: TriageManifestRow = {
      id: childId,
      org_id: manifest.org_id,
      workspace_id: manifest.workspace_id,
      goal: childGoal,
      audit: { correlationId: childCorrelation },
    };

    let outcome: { status: 'succeeded' | 'rejected' | 'failed'; message: string };
    try {
      outcome = await runTriage(childRow, deps);
    } catch (err) {
      outcome = { status: 'failed', message: (err as Error).message };
      await withTenant(deps.pool, tenant, async (client) => {
        await client.query(
          `UPDATE manifests SET status = 'failed', finished_at = now(),
                  result = $2::jsonb
            WHERE id = $1 AND status NOT IN ('succeeded','rejected','failed','cancelled')`,
          [childId, JSON.stringify({ status: 'failed', reason: outcome.message })],
        );
      });
    }

    // Read the child's terminal result for the roll-up.
    const childResult = await withTenant(deps.pool, tenant, async (client) => {
      const { rows } = await client.query<{ result: Record<string, unknown> | null }>(
        `SELECT result FROM manifests WHERE id = $1`,
        [childId],
      );
      return rows[0]?.result ?? null;
    });

    const child: BatchChildOutcome = {
      manifestId: childId,
      testPath,
      status: outcome.status,
      category: (childResult?.category as string | undefined) ?? null,
      patchedTestPath: (childResult?.patchedTestPath as string | undefined) ?? null,
      alreadyPassing: Boolean(childResult?.alreadyPassing),
      message: outcome.message,
    };
    children.push(child);

    await withTenant(deps.pool, tenant, async (client) => {
      await appendEvent(client, manifest, 'progress', null, null, {
        stage: 'child_done',
        index: i + 1,
        of: specs.length,
        childManifestId: childId,
        testPath,
        childStatus: outcome.status,
        category: child.category,
        patchedTestPath: child.patchedTestPath,
        alreadyPassing: child.alreadyPassing,
      });
    });
    log.info(
      { stage: 'child_done', index: i + 1, of: specs.length, testPath, childStatus: outcome.status },
      'Batch child finished',
    );
  }

  const totalSpend = await childrenSpendUSD(deps.pool, tenant, childIds);
  const patched = children.filter((c) => c.status === 'succeeded' && c.patchedTestPath).length;
  const alreadyPassing = children.filter((c) => c.alreadyPassing).length;
  const rejected = children.filter((c) => c.status === 'rejected').length;
  const failed = children.filter((c) => c.status === 'failed').length;
  const skipped = children.filter((c) => c.status === 'skipped_budget').length;

  await deps.artifacts.put(
    `${manifest.id}/batch-summary.json`,
    JSON.stringify({ children, totalSpendUSD: totalSpend }, null, 2),
  );

  // The batch is the deliverable: it succeeds when it processed the list,
  // even if every heal was (correctly) refused. Only an empty run of
  // failures counts as failed.
  const status: 'succeeded' | 'failed' =
    failed === children.length && children.length > 0 ? 'failed' : 'succeeded';

  return terminate(deps.pool, tenant, manifest, status, {
    total: children.length,
    patched,
    alreadyPassing,
    rejected,
    failed,
    skippedBudget: skipped,
    totalSpendUSD: Number(totalSpend.toFixed(4)),
    children,
  });
}

async function terminate(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  manifest: BatchManifestRow,
  status: 'succeeded' | 'rejected' | 'failed',
  result: Record<string, unknown>,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = $2, finished_at = now(), result = $3::jsonb WHERE id = $1`,
      [manifest.id, status, JSON.stringify({ status, ...result })],
    );
    await appendEvent(client, manifest, status, 'in_progress', status, {
      ...result,
      children: undefined, // keep the event row small; full list is in result + artifact
    });
  });
  const message =
    status === 'succeeded'
      ? 'Batch complete'
      : String((result as { reason?: string }).reason ?? status);
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const level = status === 'succeeded' ? 'info' : 'warn';
  log[level]({ status }, message);
  return { status, message };
}

async function appendEvent(
  client: pg.PoolClient,
  manifest: BatchManifestRow,
  kind: string,
  fromStatus: string | null,
  toStatus: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO manifest_events
       (manifest_id, workspace_id, kind, from_status, to_status, actor, payload, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      manifest.id,
      manifest.workspace_id,
      kind,
      fromStatus,
      toStatus,
      'system:worker',
      JSON.stringify(payload),
      manifest.audit.correlationId,
    ],
  );
}
