import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { loadPrompt } from '@poc/prompts';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import fs from 'node:fs/promises';
import {
  analyzeRuns,
  computeTrends,
  healCandidates,
  renderHealthReport,
  type RunBatch,
  type SuiteHealthReport,
  type TrendDeltas,
} from '../activities/flake-analyzer.js';
import { runPlaywrightSuite } from '../activities/suite-runner.js';
import { withTenant } from '../db.js';
import { complete } from '../llm.js';
import { manifestLogger } from '../logger.js';

export interface StewardManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      repoId?: string | null;
      runs?: number | null;
    };
  };
  audit: { correlationId: string };
}

export interface StewardDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

const DEFAULT_RUNS = 3;
const MAX_RUNS = 10;

interface RepoContext {
  repoRoot: string;
  repoName: string | null;
  playwrightProject: string;
}

async function loadRepoContext(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  config: WorkerConfig,
  repoId: string | null | undefined,
): Promise<RepoContext> {
  const fallback: RepoContext = {
    repoRoot: config.repoRoot,
    repoName: null,
    playwrightProject: config.playwrightProject,
  };
  if (!repoId) return fallback;
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{
      local_path: string | null;
      full_name: string;
      conventions: { playwright_detected?: { primaryProject?: string } } | null;
    }>(
      `SELECT r.local_path, r.full_name, p.conventions
         FROM repositories r
         LEFT JOIN repo_profiles p ON p.id = r.profile_id
        WHERE r.id = $1`,
      [repoId],
    );
    if (rows.length === 0) return fallback;
    return {
      repoRoot: rows[0].local_path ?? config.repoRoot,
      repoName: rows[0].full_name,
      playwrightProject:
        config.playwrightProject ||
        rows[0].conventions?.playwright_detected?.primaryProject ||
        '',
    };
  });
}

/**
 * StewardWorkflow (Milestone D) — suite health via repeated full runs.
 *
 *   1. Run the whole suite K times (default 3)
 *   2. Persist per-test outcomes to suite_runs / test_results
 *   3. Analyze: flaky vs always-failing vs healthy; classify error signatures
 *   4. Render a markdown health report (LLM executive summary when a key
 *      is present — the report is complete without it)
 *
 * A suite where every run fails is still a *successful* steward manifest —
 * the deliverable is the report, not a green suite.
 */
export async function runSteward(
  manifest: StewardManifestRow,
  deps: StewardDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const { repoId } = manifest.goal.params;
  const runs = Math.min(Math.max(manifest.goal.params.runs ?? DEFAULT_RUNS, 1), MAX_RUNS);
  const repo = await loadRepoContext(deps.pool, tenant, deps.config, repoId ?? null);

  await withTenant(deps.pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = 'in_progress', started_at = now() WHERE id = $1`,
      [manifest.id],
    );
    await appendEvent(client, manifest, 'progress', 'assigned', 'in_progress', {
      stage: 'started',
      workflow: 'steward',
      repoRoot: repo.repoRoot,
      runs,
    });
  });
  log.info({ stage: 'started', repoRoot: repo.repoRoot, runs }, 'Steward started');

  // ── 1+2. Run the suite K times, persisting as we go ────────────────────
  const batches: RunBatch[] = [];
  let totalDurationMs = 0;

  for (let runIndex = 1; runIndex <= runs; runIndex++) {
    const outcome = await runPlaywrightSuite(repo.repoRoot, deps.config.suiteTimeoutMs, {
      project: repo.playwrightProject,
    });
    totalDurationMs += outcome.durationMs;

    if (outcome.results.length === 0) {
      // Suite produced nothing parseable — config error, no tests, or the
      // runner crashed. One empty run means every later run would be too.
      return terminate(deps.pool, tenant, manifest, 'rejected', {
        category: 'no_results',
        reason: `Suite run ${runIndex} produced no test results (exit ${outcome.exitCode}). Tail: ${outcome.outputTail.slice(-400)}`,
      });
    }

    batches.push({ runIndex, results: outcome.results });

    const suiteRunId = randomUUID();
    await withTenant(deps.pool, tenant, async (client) => {
      await client.query(
        `INSERT INTO suite_runs
           (id, workspace_id, repo_id, manifest_id, run_index, exit_code, duration_ms,
            total, passed, failed, skipped)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          suiteRunId,
          tenant.workspaceId,
          repoId ?? null,
          manifest.id,
          runIndex,
          outcome.exitCode,
          outcome.durationMs,
          outcome.stats.total,
          outcome.stats.passed,
          outcome.stats.failed,
          outcome.stats.skipped,
        ],
      );
      for (const r of outcome.results) {
        await client.query(
          `INSERT INTO test_results
             (workspace_id, suite_run_id, file, title, project, status, duration_ms, error_head)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenant.workspaceId,
            suiteRunId,
            r.file,
            r.title,
            r.project,
            r.status,
            r.durationMs,
            r.errorHead,
          ],
        );
      }
      await appendEvent(client, manifest, 'progress', null, null, {
        stage: 'suite_run_done',
        runIndex,
        of: runs,
        durationMs: outcome.durationMs,
        passed: outcome.stats.passed,
        failed: outcome.stats.failed,
        total: outcome.stats.total,
      });
    });
    log.info(
      { stage: 'suite_run', runIndex, of: runs, ...outcome.stats, durationMs: outcome.durationMs },
      'Suite run complete',
    );
  }

  // ── 3. Analyze ──────────────────────────────────────────────────────────
  const report = analyzeRuns(batches, totalDurationMs);
  log.info(
    {
      stage: 'analyzed',
      totalTests: report.totalTests,
      healthy: report.healthy,
      flaky: report.flaky,
      alwaysFailing: report.alwaysFailing,
    },
    'Analysis complete',
  );

  // ── 4. Optional LLM executive summary ─────────────────────────────────
  let executiveSummary: string | null = null;
  if (deps.config.llmApiKey) {
    try {
      const problem = report.tests
        .filter((t) => t.verdict === 'flaky' || t.verdict === 'always_failing')
        .map((t) => ({
          test: `${t.file} › ${t.title}`,
          verdict: t.verdict,
          passed: t.passCount,
          runs: t.runsSeen,
          category: t.category,
          error: t.errorHeads[0] ?? null,
        }));
      const prompt = await loadPrompt({
        role: 'steward',
        variables: {
          repo_name: repo.repoName ?? '(default)',
          runs: String(report.runs),
          scoreboard_json: JSON.stringify(
            {
              total: report.totalTests,
              healthy: report.healthy,
              flaky: report.flaky,
              alwaysFailing: report.alwaysFailing,
              skipped: report.skipped,
            },
            null,
            2,
          ),
          problem_tests_json: JSON.stringify(problem, null, 2),
        },
      });
      const response = await complete(
        {
          workspaceId: tenant.workspaceId,
          manifestId: manifest.id,
          correlationId: manifest.audit.correlationId,
          taskClass: 'classify',
          messages: [
            ...(prompt.system ? [{ role: 'system' as const, content: prompt.system }] : []),
            { role: 'user' as const, content: prompt.user ?? '' },
          ],
          promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
          temperature: prompt.meta.temperature ?? 0.2,
          maxTokens: prompt.meta.maxTokens ?? 600,
        },
        deps.pool,
        tenant,
        deps.config,
      );
      executiveSummary = response.content.trim();
      log.info(
        { stage: 'summary', cost_usd: response.usage.costUSD, latency_ms: response.usage.latencyMs },
        'Executive summary generated',
      );
    } catch (err) {
      // The report is complete without the summary — never fail the manifest
      // over LLM garnish.
      log.warn({ stage: 'summary', err: (err as Error).message }, 'Summary LLM failed; report ships without it');
    }
  }

  // ── Trend deltas vs the previous report for this repo ─────────────────
  let trends: TrendDeltas | null = null;
  try {
    const prev = await withTenant(deps.pool, tenant, async (client) => {
      const { rows } = await client.query<{ id: string; finished_at: string }>(
        `SELECT id, finished_at FROM manifests
          WHERE role = 'steward' AND status = 'succeeded' AND id <> $1
            AND goal->'params'->>'repoId' IS NOT DISTINCT FROM $2
          ORDER BY finished_at DESC LIMIT 1`,
        [manifest.id, repoId ?? null],
      );
      return rows[0] ?? null;
    });
    if (prev) {
      const prevJson = await fs.readFile(
        deps.artifacts.getPath(`${prev.id}/steward-report.json`),
        'utf8',
      );
      trends = computeTrends(
        report,
        JSON.parse(prevJson) as SuiteHealthReport,
        new Date(prev.finished_at).toISOString().slice(0, 10),
      );
    }
  } catch (err) {
    // Trends are additive — a missing/corrupt previous artifact never blocks
    // the current report.
    log.warn({ stage: 'trends', err: (err as Error).message }, 'Skipping trend deltas');
  }

  // ── Render + persist report ────────────────────────────────────────────
  const generatedAt = new Date().toISOString();
  const candidates = healCandidates(report);
  const markdown = renderHealthReport(report, {
    repoName: repo.repoName,
    generatedAt,
    executiveSummary,
    trends,
  });
  const reportPath = `${manifest.id}/steward-report.md`;
  await deps.artifacts.put(reportPath, markdown);
  await deps.artifacts.put(
    `${manifest.id}/steward-report.json`,
    JSON.stringify(report, null, 2),
  );

  return terminate(deps.pool, tenant, manifest, 'succeeded', {
    reportPath: `local-artifacts/${reportPath}`,
    runs: report.runs,
    totalTests: report.totalTests,
    healthy: report.healthy,
    flaky: report.flaky,
    alwaysFailing: report.alwaysFailing,
    skipped: report.skipped,
    healCandidates: candidates,
    trends,
    executiveSummary,
  });
}

async function terminate(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  manifest: StewardManifestRow,
  status: 'succeeded' | 'rejected' | 'failed',
  result: Record<string, unknown>,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = $2, finished_at = now(), result = $3::jsonb WHERE id = $1`,
      [manifest.id, status, JSON.stringify({ status, ...result })],
    );
    await appendEvent(client, manifest, status, 'in_progress', status, result);
  });
  const message =
    status === 'succeeded'
      ? 'Steward report ready'
      : String((result as { reason?: string }).reason ?? status);
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const level = status === 'succeeded' ? 'info' : 'warn';
  log[level]({ status }, message);
  return { status, message };
}

async function appendEvent(
  client: pg.PoolClient,
  manifest: StewardManifestRow,
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
