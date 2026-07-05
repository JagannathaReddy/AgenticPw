import type pg from 'pg';
import type { Tenant } from './db.js';
import { withTenant } from './db.js';
import { manifestLogger } from './logger.js';

/** The slice of a claimed manifest row that event appends need. */
export interface ManifestEventSource {
  id: string;
  workspace_id: string;
  audit: { correlationId: string };
}

/**
 * Append a manifest_events row as the worker. One definition for every
 * workflow — the table is append-only, so this is the only write shape.
 */
export async function appendEvent(
  client: pg.PoolClient,
  manifest: ManifestEventSource,
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

/**
 * assigned → in_progress transition every workflow opens with: stamp
 * started_at and append the `started` progress event. The payload carries
 * the workflow name plus whatever context the role wants on record.
 */
export async function startManifest(
  pool: pg.Pool,
  tenant: Tenant,
  manifest: ManifestEventSource,
  payload: Record<string, unknown>,
): Promise<void> {
  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = 'in_progress', started_at = now() WHERE id = $1`,
      [manifest.id],
    );
    await appendEvent(client, manifest, 'progress', 'assigned', 'in_progress', payload);
  });
}

export type WorkflowTerminal = 'succeeded' | 'rejected' | 'failed';

/**
 * Terminal transition every workflow ends with: persist status + result,
 * append the terminal event, log. `successMessage` is the only thing that
 * ever differed between the six copies this replaced.
 */
export async function terminateManifest(
  pool: pg.Pool,
  tenant: Tenant,
  manifest: ManifestEventSource,
  status: WorkflowTerminal,
  result: Record<string, unknown>,
  successMessage: string,
): Promise<{ status: WorkflowTerminal; message: string }> {
  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `UPDATE manifests SET status = $2, finished_at = now(), result = $3::jsonb WHERE id = $1`,
      [manifest.id, status, JSON.stringify({ status, ...result })],
    );
    await appendEvent(client, manifest, status, 'in_progress', status, result);
  });
  const message =
    status === 'succeeded'
      ? successMessage
      : String((result as { reason?: string }).reason ?? status);
  const log = manifestLogger(manifest.id, manifest.audit.correlationId);
  const level = status === 'succeeded' ? 'info' : 'warn';
  log[level]({ status, category: (result as { category?: string }).category }, message);
  return { status, message };
}
