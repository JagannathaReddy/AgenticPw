import type pg from 'pg';
import { withTenant, type Tenant } from '../../db.js';
import type { TeammateEscalation } from '@poc/types';

export async function updateAssignmentStatus(
  pool: pg.Pool,
  tenant: Tenant,
  manifestId: string,
  status: string,
  patch: {
    loopState?: Record<string, unknown>;
    escalation?: TeammateEscalation | null;
    completed?: boolean;
  } = {},
): Promise<void> {
  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `UPDATE qa_assignments
          SET status = $2,
              loop_state = COALESCE($3::jsonb, loop_state),
              escalation = $4,
              completed_at = CASE WHEN $5 THEN COALESCE(completed_at, now()) ELSE completed_at END,
              updated_at = now()
        WHERE manifest_id = $1`,
      [
        manifestId,
        status,
        patch.loopState ? JSON.stringify(patch.loopState) : null,
        patch.escalation ? JSON.stringify(patch.escalation) : null,
        patch.completed ?? false,
      ],
    );
  });
}
