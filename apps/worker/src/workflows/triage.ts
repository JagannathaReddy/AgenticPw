import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { runHeal } from '../activities/heal.js';
import { classifyFailure } from '../activities/classify-failure.js';
import { classifyWithLLM } from '../activities/classify-llm.js';
import { captureA11ySnapshot, extractTargetUrl } from '../activities/capture-a11y.js';
import { extractErrorText, runPlaywright } from '../activities/judge-runner.js';
import {
  expandIncludeGlobs,
  extractStackPaths,
  loadRelatedSources,
} from '../activities/stack-sources.js';
import { FsCache } from '../cache.js';
import { withTenant } from '../db.js';
import { manifestLogger } from '../logger.js';

export interface TriageManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      repoId?: string | null;
      testPath: string;
      pageObjectPath?: string | null;
      includeGlobs?: string[] | null;
    };
  };
  audit: { correlationId: string };
}

export interface TriageDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

interface RepoContext {
  repoRoot: string;
  repoProfile: unknown | null;
  repoName: string | null;
}

async function loadRepoContext(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  fallbackRoot: string,
  repoId: string | null | undefined,
): Promise<RepoContext> {
  if (!repoId) return { repoRoot: fallbackRoot, repoProfile: null, repoName: null };
  return withTenant(pool, tenant, async (client) => {
    const { rows } = await client.query<{
      local_path: string | null;
      full_name: string;
      conventions: unknown | null;
    }>(
      `SELECT r.local_path, r.full_name, p.conventions
         FROM repositories r
         LEFT JOIN repo_profiles p ON p.id = r.profile_id
        WHERE r.id = $1`,
      [repoId],
    );
    if (rows.length === 0) return { repoRoot: fallbackRoot, repoProfile: null, repoName: null };
    return {
      repoRoot: rows[0].local_path ?? fallbackRoot,
      repoProfile: rows[0].conventions ?? null,
      repoName: rows[0].full_name,
    };
  });
}

async function guessPageObjectPath(repoRoot: string, specPath: string): Promise<string | null> {
  const dir = path.dirname(specPath);
  const base = path.basename(specPath).replace(/\.spec\.(tsx?)$/, '.page.$1');
  const candidates = [path.join(dir, 'pages', base), path.join(dir, base)];
  for (const rel of candidates) {
    try {
      await fs.access(path.join(repoRoot, rel));
      return rel;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

/**
 * TriageWorkflow — v0 heal loop.
 *
 *   1. Run the failing test as-is; if it now passes, ship (nothing to heal)
 *   2. Classify the failure output
 *   3. Refuse if the category isn't safe to heal
 *   4. Otherwise, call the Healer LLM and parse the response
 *   5. Write the patched spec + POM to a manifest-scoped location (never
 *      overwrite the original) and run Playwright against them
 *   6. If the patched run passes → succeeded with patch path; else → rejected
 */
export async function runTriage(
  manifest: TriageManifestRow,
  deps: TriageDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const {
    repoId,
    testPath: rawTestPath,
    pageObjectPath: rawPagePath,
    includeGlobs,
  } = manifest.goal.params;
  const repo = await loadRepoContext(deps.pool, tenant, deps.config.repoRoot, repoId ?? null);

  await withTenant(deps.pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = 'in_progress', started_at = now() WHERE id = $1`,
      [manifest.id],
    );
    await appendEvent(client, manifest, 'progress', 'assigned', 'in_progress', {
      stage: 'started',
      workflow: 'triage',
      repoId: repoId ?? null,
      repoRoot: repo.repoRoot,
      testPath: rawTestPath,
    });
  });
  log.info({ stage: 'started', testPath: rawTestPath, repoRoot: repo.repoRoot }, 'Triage started');

  const testPath = rawTestPath;
  const pageObjectPath = rawPagePath ?? (await guessPageObjectPath(repo.repoRoot, testPath));

  // Resolve the Playwright project. Priority:
  //   1. deps.config.playwrightProject (env override)
  //   2. repoProfile.playwright_detected.primaryProject (auto-detected)
  //   3. no --project — let Playwright default
  const detected = ((repo.repoProfile as Record<string, unknown> | null)
    ?.playwright_detected ?? null) as { primaryProject?: string } | null;
  const resolvedProject =
    deps.config.playwrightProject || detected?.primaryProject || '';

  // ── 1. Baseline run ────────────────────────────────────────────────────
  const baseline = await runPlaywright(repo.repoRoot, testPath, deps.config.testTimeoutMs, {
    project: resolvedProject,
  });
  log.info(
    {
      stage: 'baseline',
      passed: baseline.exitCode === 0,
      exitCode: baseline.exitCode,
      durationMs: baseline.durationMs,
    },
    'Baseline run complete',
  );

  // Persist baseline artifacts UNCONDITIONALLY, before any classification
  // decision — so a rejection is debuggable from just `local-artifacts/<id>/`
  // without needing to open Postgres.
  await deps.artifacts.put(`${manifest.id}/baseline.stdout.log`, baseline.stdout);
  await deps.artifacts.put(`${manifest.id}/baseline.stderr.log`, baseline.stderr);
  if (baseline.json) {
    await deps.artifacts.put(
      `${manifest.id}/baseline.json`,
      JSON.stringify(baseline.json, null, 2),
    );
  }

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'baseline_done',
      exitCode: baseline.exitCode,
      passed: baseline.exitCode === 0,
      durationMs: baseline.durationMs,
    });
  });

  if (baseline.exitCode === 0 && !baseline.timedOut) {
    return terminate(deps.pool, tenant, manifest, 'succeeded', {
      alreadyPassing: true,
      testPath,
    });
  }

  // ── 2. Classify ────────────────────────────────────────────────────────
  const errorText = extractErrorText(baseline.json);
  let classification = classifyFailure({ errorText, output: baseline.output });

  // When the fast regex path bailed to `unknown`, escalate to an LLM
  // classifier before rejecting. Real-repo error strings are typically
  // wrapped in custom error classes the regexes can't parse.
  if (classification.category === 'unknown') {
    const llmVerdict = await classifyWithLLM(
      {
        manifestId: manifest.id,
        correlationId: manifest.audit.correlationId,
        testPath,
        errorText,
        rawOutput: baseline.output,
      },
      deps.config,
      deps.pool,
      tenant,
    );
    if (llmVerdict) {
      log.info(
        {
          stage: 'classify_llm',
          category: llmVerdict.category,
          isSafeToHeal: llmVerdict.isSafeToHeal,
          summary: llmVerdict.summary,
        },
        'LLM classifier rescued a regex-unknown',
      );
      classification = llmVerdict;
    }
  }

  log.info(
    {
      stage: 'classify',
      category: classification.category,
      isSafeToHeal: classification.isSafeToHeal,
      via: classification.evidence.startsWith('LLM fallback') ? 'llm' : 'regex',
    },
    'Classified failure',
  );

  // Persist the full classification result too — the manifest_events row
  // stores only the short `evidence`; the file has the full errorText and
  // both haystacks the regexes ran against.
  await deps.artifacts.put(
    `${manifest.id}/classification.json`,
    JSON.stringify(
      {
        ...classification,
        errorTextLength: errorText.length,
        errorTextTail: errorText.slice(-2000),
        rawOutputTail: baseline.output.slice(-2000),
      },
      null,
      2,
    ),
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'classified',
      category: classification.category,
      isSafeToHeal: classification.isSafeToHeal,
      summary: classification.summary,
      evidence: classification.evidence,
    });
  });

  if (!classification.isSafeToHeal) {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: classification.category,
      reason: `Refuse-to-heal: ${classification.summary}`,
    });
  }

  // ── 3. Gather helper sources from the stack trace (#10) ───────────────
  // Enterprise suites route failures through layers of helper classes; the
  // healer needs to see those files or it patches blind. Walk the stack in
  // the failure output, load the top frames, and honor --include globs.
  const stackPaths = extractStackPaths(`${errorText}\n${baseline.output}`);
  const includedPaths =
    includeGlobs && includeGlobs.length > 0
      ? await expandIncludeGlobs(repo.repoRoot, includeGlobs)
      : [];
  const related = await loadRelatedSources(
    repo.repoRoot,
    // User-supplied globs first — explicit beats inferred when we hit the cap.
    [...includedPaths, ...stackPaths],
    { exclude: [testPath, pageObjectPath], max: 3 },
  );

  if (related.loaded.length > 0 || related.missing.length > 0) {
    log.info(
      {
        stage: 'related_sources',
        loaded: related.loaded.map((s) => s.path),
        missing: related.missing,
        fromGlobs: includedPaths.length,
        fromStack: stackPaths.length,
      },
      'Gathered related sources for healer',
    );
    await withTenant(deps.pool, tenant, async (client) => {
      await appendEvent(client, manifest, 'progress', null, null, {
        stage: 'related_sources',
        loaded: related.loaded.map((s) => s.path),
        missing: related.missing,
      });
    });
  }

  // The stack points at helper files that don't exist on disk (renamed,
  // generated, or outside the registered repoRoot). Healing blind would
  // produce a nonsense patch — refuse with a category the user can act on
  // instead of letting it fall through as `unknown` after a wasted LLM call.
  const stackBeyondSpec = stackPaths.filter(
    (p) => p !== testPath && p !== pageObjectPath,
  );
  if (
    stackBeyondSpec.length > 0 &&
    related.loaded.length === 0 &&
    related.missing.length > 0
  ) {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: 'out_of_scope',
      reason:
        `Failure originates in files the agent cannot read: ` +
        `${related.missing.join(', ')}. ` +
        `If they live elsewhere, re-run with --include '<glob>' or register the repo with the correct path.`,
    });
  }

  // ── 4. Snapshot the target page (best-effort, non-blocking) ───────────
  const specSource = await fs
    .readFile(path.join(repo.repoRoot, testPath), 'utf8')
    .catch(() => '');
  const pageSource = pageObjectPath
    ? await fs.readFile(path.join(repo.repoRoot, pageObjectPath), 'utf8').catch(() => '')
    : '';
  const targetUrl = extractTargetUrl(specSource, pageSource);

  let ariaSnapshotYaml = '(no target URL detected in the sources)';
  let a11yMeta: { url: string; capturedAt: string; durationMs: number } | null = null;

  if (targetUrl) {
    log.info({ stage: 'snapshot', targetUrl }, 'Capturing a11y snapshot');
    const cache = new FsCache({ rootDir: deps.config.artifactsDir });
    const snap = await captureA11ySnapshot(targetUrl, deps.config.browserTimeoutMs, false, cache);
    if (snap) {
      ariaSnapshotYaml = snap.yaml;
      a11yMeta = { url: snap.url, capturedAt: snap.capturedAt, durationMs: snap.durationMs };
      await deps.artifacts.put(
        `${manifest.id}/aria-snapshot.yaml`,
        [`# url: ${snap.url}`, `# captured: ${snap.capturedAt}`, '', snap.yaml].join('\n'),
      );
    } else {
      ariaSnapshotYaml = `(failed to capture snapshot at ${targetUrl})`;
    }
  }

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'snapshot',
      targetUrl,
      captured: a11yMeta !== null,
      ...(a11yMeta ?? {}),
    });
  });

  // ── 5. LLM heal ────────────────────────────────────────────────────────
  log.info({ stage: 'heal' }, 'Calling healer LLM');
  let heal;
  try {
    heal = await runHeal(
      {
        manifestId: manifest.id,
        correlationId: manifest.audit.correlationId,
        testPath,
        pageObjectPath,
        failureOutputTail: baseline.output,
        classification,
        ariaSnapshot: ariaSnapshotYaml,
        repoRoot: repo.repoRoot,
        repoProfile: repo.repoProfile,
        relatedSources: related.loaded,
      },
      deps.artifacts,
      deps.config,
      deps.pool,
      tenant,
    );
  } catch (err) {
    // A malformed LLM response must reject THIS manifest, not crash the
    // poll loop and leave it stuck in_progress until the next worker boot.
    const message = (err as Error).message;
    log.warn({ stage: 'heal', err: message }, 'Healer failed');
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: 'heal_parse_error',
      reason: `Healer response could not be used: ${message}. Raw output is in heal-raw.md.`,
    });
  }
  log.info(
    {
      stage: 'heal',
      cost_usd: heal.usage.costUSD,
      tokens_in: heal.usage.tokensInput,
      tokens_out: heal.usage.tokensOutput,
      latency_ms: heal.usage.latencyMs,
      kind: heal.parse.kind,
    },
    'Healer LLM done',
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'heal_llm_done',
      kind: heal.parse.kind,
      prompt: heal.promptRef,
      usage: heal.usage,
    });
  });

  if (heal.parse.kind === 'refused') {
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: heal.parse.category,
      reason: `Healer refused: ${heal.parse.reason}`,
    });
  }

  // ── 6. Write patched files to a manifest-scoped subdir ────────────────
  const shortId = manifest.id.slice(0, 8);
  const patchDir = path.join('tests', 'triaged', shortId);
  const patchedSpecRel = path.join(patchDir, path.basename(heal.parse.files.test.path));
  const patchedPageRel = path.join(
    patchDir,
    'pages',
    path.basename(heal.parse.files.pageObject.path),
  );

  // Save copies into local-artifacts for the record
  await deps.artifacts.put(
    `${manifest.id}/patched/${patchedSpecRel}`,
    heal.parse.files.test.content,
  );
  await deps.artifacts.put(
    `${manifest.id}/patched/${patchedPageRel}`,
    heal.parse.files.pageObject.content,
  );

  // Copy into repo for Playwright to find
  const specAbs = path.join(repo.repoRoot, patchedSpecRel);
  const pageAbs = path.join(repo.repoRoot, patchedPageRel);
  await fs.mkdir(path.dirname(specAbs), { recursive: true });
  await fs.mkdir(path.dirname(pageAbs), { recursive: true });
  await fs.writeFile(specAbs, heal.parse.files.test.content);
  await fs.writeFile(pageAbs, heal.parse.files.pageObject.content);

  // ── 7. Verify the patched test passes ─────────────────────────────────
  const verify = await runPlaywright(repo.repoRoot, patchedSpecRel, deps.config.testTimeoutMs, {
    project: resolvedProject,
  });
  log.info(
    {
      stage: 'verify',
      passed: verify.exitCode === 0,
      exitCode: verify.exitCode,
      durationMs: verify.durationMs,
    },
    'Verified patched test',
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'verify_done',
      exitCode: verify.exitCode,
      passed: verify.exitCode === 0,
      durationMs: verify.durationMs,
      patchedTestPath: patchedSpecRel,
      patchedPageObjectPath: patchedPageRel,
    });
  });

  if (verify.exitCode === 0 && !verify.timedOut) {
    return terminate(deps.pool, tenant, manifest, 'succeeded', {
      originalTestPath: testPath,
      patchedTestPath: patchedSpecRel,
      patchedPageObjectPath: patchedPageRel,
      category: classification.category,
    });
  }

  return terminate(deps.pool, tenant, manifest, 'rejected', {
    category: 'heal_did_not_pass',
    reason: `Patched test still fails: exit ${verify.exitCode}. Tail: ${verify.output.slice(-500)}`,
    patchedTestPath: patchedSpecRel,
  });
}

async function terminate(
  pool: pg.Pool,
  tenant: { orgId: string; workspaceId: string },
  manifest: TriageManifestRow,
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
      ? 'Triage complete'
      : String((result as { reason?: string }).reason ?? status);
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const level = status === 'succeeded' ? 'info' : 'warn';
  log[level]({ status, category: (result as { category?: string }).category }, message);
  return { status, message };
}

async function appendEvent(
  client: pg.PoolClient,
  manifest: TriageManifestRow,
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
