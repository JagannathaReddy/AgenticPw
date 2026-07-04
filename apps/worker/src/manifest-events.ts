import type pg from 'pg';

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
