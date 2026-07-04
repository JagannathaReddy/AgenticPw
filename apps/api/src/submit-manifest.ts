import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ManifestBudget, ManifestPolicy } from '@poc/types';
import type { Db, TenantContext } from './db.js';
import { withTenant } from './db.js';

/**
 * Shared submit path for every role's POST route: one manifests row
 * (`pending`) plus its `created` event, atomically on one client. Routes
 * differ only in role / goal / budget / policy / success gate.
 */
export interface SubmitManifestArgs {
  role: string;
  goal: { kind: string; description: string; params: Record<string, unknown> };
  budget: ManifestBudget;
  policy: ManifestPolicy;
  successGate: { verifier: string; criteria: string[] };
  /** Echoed into the created-event payload — the audit trail of what was asked. */
  eventInput: unknown;
}

export interface SubmittedManifest {
  manifestId: string;
  workflowId: string;
  correlationId: string;
  status: 'pending';
}

/** Client-scoped core — for routes that already hold a tenant client. */
export async function insertManifestRows(
  client: pg.PoolClient,
  tenant: TenantContext,
  userId: string,
  args: SubmitManifestArgs,
): Promise<SubmittedManifest> {
  const manifestId = randomUUID();
  const correlationId = randomUUID();
  // Q1 local: workflowId is just the manifest id — no Temporal yet.
  const workflowId = `local-${manifestId}`;

  await client.query(
    `INSERT INTO manifests (
       id, org_id, workspace_id, role, status, workflow_id,
       goal, context, budget, success_gate, policy, audit
     ) VALUES ($1, $2, $3, $4, 'pending', $5,
               $6, $7, $8, $9, $10, $11)`,
    [
      manifestId,
      tenant.orgId,
      tenant.workspaceId,
      args.role,
      workflowId,
      JSON.stringify(args.goal),
      JSON.stringify({ memoryRefs: [], priorManifests: [] }),
      JSON.stringify(args.budget),
      JSON.stringify(args.successGate),
      JSON.stringify(args.policy),
      JSON.stringify({ correlationId }),
    ],
  );

  await client.query(
    `INSERT INTO manifest_events (manifest_id, workspace_id, kind, from_status, to_status, actor, payload, correlation_id)
     VALUES ($1, $2, 'created', NULL, 'pending', $3, $4::jsonb, $5)`,
    [
      manifestId,
      tenant.workspaceId,
      `user:${userId}`,
      JSON.stringify({ input: args.eventInput }),
      correlationId,
    ],
  );

  return { manifestId, workflowId, correlationId, status: 'pending' };
}

/** Opens its own tenant scope — the common case. */
export async function submitManifest(
  db: Db,
  tenant: TenantContext,
  userId: string,
  args: SubmitManifestArgs,
): Promise<SubmittedManifest> {
  return withTenant(db, tenant, (client) =>
    insertManifestRows(client, tenant, userId, args),
  );
}
