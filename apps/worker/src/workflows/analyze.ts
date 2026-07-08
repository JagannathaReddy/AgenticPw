import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { analyzeManifests } from '../activities/analyze-manifests.js';
import { withTenant, type Tenant } from '../db.js';
import { manifestLogger } from '../logger.js';
import {
  appendEvent,
  startManifest,
  terminateManifest,
  type WorkflowTerminal,
} from '../manifest-events.js';

/**
 * AnalyzeWorkflow (L4 sprint A.1) — read-only pattern detection over
 * recent rejected manifests. Emits a Markdown report artifact and a
 * clusters summary in the manifest result. No LLM in A.1; A.2 adds
 * LLM-driven proposal generation on top of the same clusters.
 */

export interface AnalyzeManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      sinceHours?: number;
      roleFilter?: string | null;
      minClusterSize?: number;
      maxRows?: number;
    };
  };
  audit: { correlationId: string };
}

export interface AnalyzeDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

export async function runAnalyze(
  manifest: AnalyzeManifestRow,
  deps: AnalyzeDeps,
): Promise<{ status: WorkflowTerminal; message: string }> {
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const params = manifest.goal.params;
  const sinceHours = params.sinceHours ?? 168;
  const roleFilter = params.roleFilter ?? null;
  const minClusterSize = params.minClusterSize ?? 2;

  await startManifest(deps.pool, tenant, manifest, {
    stage: 'started',
    workflow: 'analyze',
    sinceHours,
    roleFilter,
    minClusterSize,
  });
  log.info({ stage: 'started', sinceHours, roleFilter }, 'Analyzer started');

  const result = await analyzeManifests(
    { sinceHours, roleFilter, minClusterSize, maxRows: params.maxRows },
    deps.pool,
    tenant,
  );

  const reportPath = `${manifest.id}/analyzer-report.md`;
  await deps.artifacts.put(reportPath, result.markdown);
  await deps.artifacts.put(
    `${manifest.id}/analyzer-clusters.json`,
    JSON.stringify(
      { window: result.window, clusters: result.clusters, rejectedTotal: result.rejectedTotal },
      null,
      2,
    ),
  );

  await withTenant(deps.pool, tenant, async (client) => {
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'clusters_ready',
      rejectedTotal: result.rejectedTotal,
      clusterCount: result.clusters.length,
      totalWastedUSD: result.totalWastedUSD,
    });
  });

  log.info(
    {
      stage: 'clusters_ready',
      rejectedTotal: result.rejectedTotal,
      clusterCount: result.clusters.length,
      totalWastedUSD: result.totalWastedUSD,
    },
    'Analyzer clusters ready',
  );

  return terminateManifest(
    deps.pool,
    tenant,
    manifest,
    'succeeded',
    {
      reportPath: `local-artifacts/${reportPath}`,
      rejectedTotal: result.rejectedTotal,
      clusterCount: result.clusters.length,
      totalWastedUSD: result.totalWastedUSD,
      window: result.window,
      clusters: result.clusters,
    },
    'Analyzer report ready',
  );
}
