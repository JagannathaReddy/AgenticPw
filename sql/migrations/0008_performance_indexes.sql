-- 0008_performance_indexes.sql
-- Performance indexes discovered during Q1 load tests. Kept separate from
-- table-creation migrations so we can tune without touching schema history.
-- All CREATE INDEX statements use CONCURRENTLY where safe (i.e., not inside
-- a transaction). node-pg-migrate honors this file being run outside a tx.

-- NOTE: this file intentionally has no BEGIN/COMMIT. The runner detects
-- CONCURRENTLY and executes without a transaction.

-- Manifest listing (dashboard queries) -----------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS manifests_workspace_role_status_idx
  ON manifests (workspace_id, role, status, created_at DESC);

-- Recent activity in the UI ("what did the agent do in the last 24h?")
-- Full index: partial predicates cannot use now() (STABLE, not IMMUTABLE).
CREATE INDEX CONCURRENTLY IF NOT EXISTS manifest_events_recent_idx
  ON manifest_events (workspace_id, ts DESC);

-- LLM cost aggregation ("show me today's spend by model")
-- Index raw ts; date_trunc(timestamptz) is STABLE and invalid in index keys.
CREATE INDEX CONCURRENTLY IF NOT EXISTS llm_calls_workspace_model_ts_idx
  ON llm_calls (workspace_id, provider, model, ts DESC);

-- Audit lookup by correlation id (incident triage)
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_org_correlation_idx
  ON audit_log (org_id, correlation_id, ts DESC)
  WHERE correlation_id IS NOT NULL;

-- Memory recall for a given repo + host (hot path for Explorer + Generator)
CREATE INDEX CONCURRENTLY IF NOT EXISTS memory_flows_lookup_idx
  ON memory_flows (repo_id, host, goal_hash);
