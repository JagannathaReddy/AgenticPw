-- 0004_llm_calls_and_audit.sql
-- Every LLM call is logged for cost + eval. Audit log is append-only and
-- exported nightly to S3 with Object Lock (WORM).

BEGIN;

-- LLM usage log -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_calls (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  manifest_id        UUID NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  correlation_id     UUID NOT NULL,

  provider           TEXT NOT NULL
                       CHECK (provider IN ('anthropic', 'openai', 'google')),
  model              TEXT NOT NULL,                    -- e.g., 'claude-sonnet-4-6'
  task_class         TEXT NOT NULL
                       CHECK (task_class IN ('plan', 'generate', 'classify', 'verify')),
  prompt_id          TEXT NOT NULL,                    -- e.g., 'generator.system.v1'
  prompt_hash        TEXT NOT NULL,                    -- sha256 of the rendered prompt

  tokens_in          INTEGER NOT NULL CHECK (tokens_in >= 0),
  tokens_out         INTEGER NOT NULL CHECK (tokens_out >= 0),
  cost_usd           NUMERIC(10, 6) NOT NULL CHECK (cost_usd >= 0),
  latency_ms         INTEGER NOT NULL CHECK (latency_ms >= 0),

  outcome            TEXT NOT NULL
                       CHECK (outcome IN ('ok', 'fallback', 'error', 'budget_exceeded')),
  error_code         TEXT,

  ts                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_calls_workspace_ts_idx
  ON llm_calls (workspace_id, ts DESC);
CREATE INDEX IF NOT EXISTS llm_calls_manifest_idx
  ON llm_calls (manifest_id);
CREATE INDEX IF NOT EXISTS llm_calls_correlation_idx
  ON llm_calls (correlation_id);
CREATE INDEX IF NOT EXISTS llm_calls_daily_agg_idx
  ON llm_calls (workspace_id, provider, model, ts);

-- Audit log ---------------------------------------------------------------
-- Every meaningful action across the platform. Nightly export to S3 with
-- Object Lock; 7-year retention. Live table retains 90 days.
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  org_id          UUID NOT NULL,
  workspace_id    UUID,                              -- nullable for org-level actions
  actor           TEXT NOT NULL,                     -- 'user:<workos_id>' or 'system:<service>'
  actor_ip        INET,
  action          TEXT NOT NULL,                     -- 'manifest.created', 'repo.onboarded', etc.
  resource_kind   TEXT NOT NULL,                     -- 'manifest', 'repo', 'workspace', 'llm_call'
  resource_id     TEXT NOT NULL,
  outcome         JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id  UUID,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_org_ts_idx
  ON audit_log (org_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_correlation_idx
  ON audit_log (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_actor_ts_idx
  ON audit_log (actor, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx
  ON audit_log (resource_kind, resource_id);

-- Retention policy: enforced by nightly job, not the DB.
-- See infra/cron/audit-log-export.md

COMMIT;
