-- 20260702101403_manifests.sql
-- Task Manifest — the orchestration contract. Event-sourced state changes
-- via manifest_events; manifests row is the current-state projection.

BEGIN;

CREATE TABLE IF NOT EXISTS manifests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL,
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  parent_manifest_id  UUID REFERENCES manifests(id) ON DELETE SET NULL,
  workflow_id         TEXT NOT NULL,                     -- Temporal workflow id (source of truth)

  role                TEXT NOT NULL
                        CHECK (role IN (
                          'orchestrator', 'coverage', 'triage', 'steward', 'teammate', 'analyzer',
                          'onboarding', 'improver', 'quarantiner',
                          'explorer', 'generator', 'healer', 'reviewer', 'judge'
                        )),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'assigned', 'in_progress',
                          'succeeded', 'failed', 'rejected', 'cancelled'
                        )),

  goal                JSONB NOT NULL,                    -- ManifestGoal (see types.ts)
  context             JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget              JSONB NOT NULL,                    -- ManifestBudget
  success_gate        JSONB NOT NULL,                    -- ManifestSuccessGate
  policy              JSONB NOT NULL,                    -- ManifestPolicy (trust rung, permissions)
  audit               JSONB NOT NULL,                    -- ManifestAudit { correlationId, signalId }

  result              JSONB,                             -- terminal payload (pr_url, reject reason, etc.)
  error_code          TEXT,
  error_message       TEXT,

  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manifests_workspace_status_idx
  ON manifests (workspace_id, status);
CREATE INDEX IF NOT EXISTS manifests_workflow_id_idx
  ON manifests (workflow_id);
CREATE INDEX IF NOT EXISTS manifests_parent_idx
  ON manifests (parent_manifest_id) WHERE parent_manifest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS manifests_correlation_idx
  ON manifests ((audit ->> 'correlationId'));
CREATE INDEX IF NOT EXISTS manifests_created_at_idx
  ON manifests (workspace_id, created_at DESC);

DROP TRIGGER IF EXISTS manifests_touch ON manifests;
CREATE TRIGGER manifests_touch
  BEFORE UPDATE ON manifests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Event log ---------------------------------------------------------------
-- Append-only. Every state transition, every checkpoint. Never updated.
CREATE TABLE IF NOT EXISTS manifest_events (
  id              BIGSERIAL PRIMARY KEY,
  manifest_id     UUID NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL,                     -- denormalized for RLS + fast queries
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind            TEXT NOT NULL,                     -- 'created', 'assigned', 'progress', 'log', 'succeeded', ...
  from_status     TEXT,
  to_status       TEXT,
  actor           TEXT NOT NULL,                     -- 'system:orchestrator', 'user:<workos_id>', 'workflow:<name>'
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id  UUID
);

CREATE INDEX IF NOT EXISTS manifest_events_manifest_ts_idx
  ON manifest_events (manifest_id, ts);
CREATE INDEX IF NOT EXISTS manifest_events_workspace_ts_idx
  ON manifest_events (workspace_id, ts);
CREATE INDEX IF NOT EXISTS manifest_events_correlation_idx
  ON manifest_events (correlation_id) WHERE correlation_id IS NOT NULL;

-- Guard: only inserts allowed on manifest_events. Enforced by revoking
-- UPDATE + DELETE at the role level in the rls_policies migration.

COMMIT;
