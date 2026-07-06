import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { runOnboarding } from '../activities/onboarding.js';
import { withTenant, type Tenant } from '../db.js';
import { manifestLogger } from '../logger.js';
import { embedRepoSpecs } from '../activities/embed-specs.js';
import {
  appendEvent,
  startManifest,
  terminateManifest,
  type WorkflowTerminal,
} from '../manifest-events.js';

export interface OnboardingManifestRow {
  id: string;
  org_id: string;
  workspace_id: string;
  goal: {
    kind: string;
    description: string;
    params: {
      repoId: string;
      localPath: string;
    };
  };
  audit: { correlationId: string };
}

export interface OnboardingDeps {
  pool: pg.Pool;
  artifacts: ArtifactStore;
  config: WorkerConfig;
}

/**
 * OnboardingWorkflow — analyze a repo and persist a RepoProfile row.
 *
 * Terminal outcomes:
 *   - succeeded: profile row inserted, repo_profiles.id set on repositories.profile_id,
 *     repositories.status = 'review'
 *   - rejected: LLM output couldn't be parsed as YAML
 *   - failed: unexpected error
 */
export async function runOnboardingWorkflow(
  manifest: OnboardingManifestRow,
  deps: OnboardingDeps,
): Promise<{ status: 'succeeded' | 'rejected' | 'failed'; message: string }> {
  const goal = manifest.goal;
  const tenant = { orgId: manifest.org_id, workspaceId: manifest.workspace_id };
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const { repoId, localPath } = goal.params;

  await startManifest(deps.pool, tenant, manifest, {
      stage: 'started',
      workflow: 'onboarding',
      repoId,
      localPath,
    });
  log.info({ stage: 'started', repoId, localPath }, 'Onboarding started');

  let extraction;
  try {
    extraction = await runOnboarding(
      {
        manifestId: manifest.id,
        correlationId: manifest.audit.correlationId,
        repoId,
        localPath,
      },
      deps.artifacts,
      deps.config,
      deps.pool,
      tenant,
    );
  } catch (err) {
    const message = (err as Error).message;
    log.warn({ stage: 'extractor', err: message }, 'Extractor failed');
    return terminate(deps.pool, tenant, manifest, 'rejected', {
      category: 'extractor_failed',
      reason: message,
    });
  }

  log.info(
    {
      stage: 'extractor',
      confidence: extraction.confidence,
      filesSampled: extraction.filesSampled,
      fixturesSampled: extraction.fixturesSampled,
      cost_usd: extraction.usage.costUSD,
      tokens_in: extraction.usage.tokensInput,
      tokens_out: extraction.usage.tokensOutput,
      latency_ms: extraction.usage.latencyMs,
    },
    'Extractor done',
  );

  const profileId = randomUUID();
  await withTenant(deps.pool, tenant, async (client) => {
    await client.query(
      `INSERT INTO repo_profiles
         (id, repo_id, workspace_id, conventions, extractor_version, confidence)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        profileId,
        repoId,
        tenant.workspaceId,
        JSON.stringify(extraction.profile),
        extraction.extractorVersion,
        extraction.confidence,
      ],
    );
    await client.query(
      `UPDATE repositories
         SET profile_id = $1, status = 'review', onboarded_at = now()
       WHERE id = $2`,
      [profileId, repoId],
    );
    await appendEvent(client, manifest, 'progress', null, null, {
      stage: 'profile_persisted',
      profileId,
      confidence: extraction.confidence,
    });
  });

  // Sprint 8: embed spec files for semantic RAG. Best-effort — the keyword
  // picker is always there, so embeddings never fail an onboarding.
  let embeddings: { files: number; embedded: number; unchanged: number } | null = null;
  try {
    embeddings = await embedRepoSpecs(
      localPath,
      repoId,
      {
        workspaceId: manifest.workspace_id,
        manifestId: manifest.id,
        correlationId: manifest.audit.correlationId,
      },
      deps.pool,
      tenant,
    );
    await withTenant(deps.pool, tenant, async (client) => {
      await appendEvent(client, manifest, 'progress', null, null, {
        stage: 'embeddings_done',
        ...embeddings,
      });
    });
    log.info({ stage: 'embeddings_done', ...embeddings }, 'Spec embeddings ready');
  } catch (err) {
    log.warn({ stage: 'embeddings', err: (err as Error).message }, 'Embeddings skipped');
  }

  return terminate(deps.pool, tenant, manifest, 'succeeded', {
    profileId,
    confidence: extraction.confidence,
    filesSampled: extraction.filesSampled,
    fixturesSampled: extraction.fixturesSampled,
    embeddings,
  });
}

const terminate = (
  pool: pg.Pool,
  tenant: Tenant,
  manifest: OnboardingManifestRow,
  status: WorkflowTerminal,
  result: Record<string, unknown>,
) => terminateManifest(pool, tenant, manifest, status, result, 'Onboarding complete');

