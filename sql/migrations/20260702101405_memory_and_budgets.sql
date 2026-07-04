-- 20260702101405_memory_and_budgets.sql
-- Memory: learned locators + action patterns per (repo, goal-hash).
-- Budgets: hard caps enforced pre-call by LLM Gateway.

BEGIN;

-- Memory flows -------------------------------------------------------------
-- One row per (repo, goal_hash). Successful runs update it, incrementing
-- success_count. Q1 stores JSON blobs; Q2 will add pgvector embeddings.
CREATE TABLE IF NOT EXISTS memory_flows (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id        UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,

  goal_hash      TEXT NOT NULL,                        -- sha256(host + normalized goal), 16-char prefix
  goal           TEXT NOT NULL,                        -- verbatim goal, for debugging
  host           TEXT NOT NULL,                        -- normalized host from URL
  template       TEXT NOT NULL DEFAULT 'generic',      -- 'login' | 'generic' | ...

  actions        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- NormalizedAction[]
  locators       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- LearnedLocator[]
  test_path      TEXT,                                 -- last known passing test file
  last_manifest_id UUID REFERENCES manifests(id) ON DELETE SET NULL,

  success_count  INTEGER NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_id, goal_hash)
);

CREATE INDEX IF NOT EXISTS memory_flows_workspace_idx
  ON memory_flows (workspace_id);
CREATE INDEX IF NOT EXISTS memory_flows_repo_host_idx
  ON memory_flows (repo_id, host);

DROP TRIGGER IF EXISTS memory_flows_touch ON memory_flows;
CREATE TRIGGER memory_flows_touch
  BEFORE UPDATE ON memory_flows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Host-level memory (cross-goal aggregation of locators per host) ----------
CREATE TABLE IF NOT EXISTS memory_hosts (
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id        UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  host           TEXT NOT NULL,
  locators       JSONB NOT NULL DEFAULT '[]'::jsonb,
  success_count  INTEGER NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, host)
);

CREATE INDEX IF NOT EXISTS memory_hosts_workspace_idx
  ON memory_hosts (workspace_id);

-- Budgets -----------------------------------------------------------------
-- Per-workspace daily / monthly hard caps. Updated by LLM Gateway on every
-- call; checked pre-call. Q1: single-row-per-workspace tracking; Q2 splits
-- by provider + model when we start real optimization.
CREATE TABLE IF NOT EXISTS budgets (
  workspace_id       UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  daily_usd          NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
  monthly_usd        NUMERIC(10, 2) NOT NULL DEFAULT 1000.00,

  current_day        DATE NOT NULL DEFAULT current_date,
  current_day_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0,
  current_month      DATE NOT NULL DEFAULT date_trunc('month', current_date)::date,
  current_month_usd  NUMERIC(10, 6) NOT NULL DEFAULT 0,

  warn_at_pct        SMALLINT NOT NULL DEFAULT 80
                        CHECK (warn_at_pct BETWEEN 1 AND 100),
  throttle_at_pct    SMALLINT NOT NULL DEFAULT 90
                        CHECK (throttle_at_pct BETWEEN 1 AND 100),

  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS budgets_touch ON budgets;
CREATE TRIGGER budgets_touch
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rollover helper (called by LLM Gateway before the daily check)
CREATE OR REPLACE FUNCTION roll_over_budget(p_workspace_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE budgets
     SET current_day = current_date,
         current_day_usd = 0
   WHERE workspace_id = p_workspace_id
     AND current_day <> current_date;

  UPDATE budgets
     SET current_month = date_trunc('month', current_date)::date,
         current_month_usd = 0
   WHERE workspace_id = p_workspace_id
     AND current_month <> date_trunc('month', current_date)::date;
END;
$$ LANGUAGE plpgsql;

COMMIT;
