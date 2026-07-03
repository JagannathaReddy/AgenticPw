-- 0012_steward_runs.sql
-- Milestone D (Steward): per-test outcomes across repeated suite runs.
--
-- suite_runs   — one row per `npx playwright test` invocation the Steward made
-- test_results — one row per (test, run); the flake analyzer reads these
--
-- RLS follows the 0006 pattern: scope by workspace, system context bypasses.
-- Both tables are append-only for app_user, like manifest_events.

BEGIN;

CREATE TABLE IF NOT EXISTS suite_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  repo_id       UUID REFERENCES repositories(id) ON DELETE SET NULL,
  manifest_id   UUID NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  run_index     INT  NOT NULL,                       -- 1-based within the steward batch
  exit_code     INT  NOT NULL,
  duration_ms   INT  NOT NULL,
  total         INT  NOT NULL DEFAULT 0,
  passed        INT  NOT NULL DEFAULT 0,
  failed        INT  NOT NULL DEFAULT 0,
  skipped       INT  NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_results (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  suite_run_id  UUID NOT NULL REFERENCES suite_runs(id) ON DELETE CASCADE,
  file          TEXT NOT NULL,                       -- repo-relative spec path
  title         TEXT NOT NULL,                       -- full test title
  project       TEXT,                                -- Playwright project name
  status        TEXT NOT NULL
                  CHECK (status IN ('passed', 'failed', 'timedOut', 'skipped', 'interrupted')),
  duration_ms   INT  NOT NULL DEFAULT 0,
  error_head    TEXT,                                -- first line of the first error, for signatures
  category      TEXT                                 -- classifier category when failed
);

CREATE INDEX IF NOT EXISTS idx_suite_runs_manifest ON suite_runs (manifest_id);
CREATE INDEX IF NOT EXISTS idx_test_results_run    ON test_results (suite_run_id);
CREATE INDEX IF NOT EXISTS idx_test_results_ident  ON test_results (workspace_id, file, title);

-- RLS ----------------------------------------------------------------------

ALTER TABLE suite_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suite_runs_scope ON suite_runs;
CREATE POLICY suite_runs_scope ON suite_runs
  USING (workspace_id = current_workspace_id() OR is_system_context());

ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS test_results_scope ON test_results;
CREATE POLICY test_results_scope ON test_results
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- Append-only from the app, like manifest_events
REVOKE UPDATE, DELETE ON suite_runs FROM app_user;
REVOKE UPDATE, DELETE ON test_results FROM app_user;

COMMIT;
