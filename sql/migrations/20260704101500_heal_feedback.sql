-- 20260704101500_heal_feedback.sql
-- Sprint 3a (#16): human feedback on heal outcomes.
--
-- heal_feedback — one row per signal about a triage manifest's patch:
--   verdict 'up'/'down', source 'explicit' (agent feedback) or 'apply'
--   (implicit thumbs-up recorded when the user applies the patch).
-- The row snapshots category / prompt hash / model at write time so the
-- eval harness can compute accept-rates per (category, prompt, model) even
-- after prompts change.
--
-- RLS follows the rls_policies pattern: scope by workspace, system context bypasses.
-- Append-only for app_user, like manifest_events — feedback is a ledger,
-- a changed mind is a new row (latest explicit row wins at query time).

BEGIN;

CREATE TABLE IF NOT EXISTS heal_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  repo_id       UUID REFERENCES repositories(id) ON DELETE SET NULL,
  manifest_id   UUID NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  verdict       TEXT NOT NULL CHECK (verdict IN ('up', 'down')),
  source        TEXT NOT NULL CHECK (source IN ('explicit', 'apply')),
  category      TEXT,                                -- failure category at heal time
  test_path     TEXT,                                -- repo-relative spec the heal targeted
  prompt_file   TEXT,                                -- healer prompt id at heal time
  prompt_hash   TEXT,                                -- healer prompt hash at heal time
  model         TEXT,                                -- LLM model that produced the patch
  note          TEXT,                                -- free-text from --note
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One implicit apply-vote per manifest; explicit rows are unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS idx_heal_feedback_apply_once
  ON heal_feedback (manifest_id) WHERE source = 'apply';
CREATE INDEX IF NOT EXISTS idx_heal_feedback_manifest
  ON heal_feedback (manifest_id);
CREATE INDEX IF NOT EXISTS idx_heal_feedback_repo_recent
  ON heal_feedback (workspace_id, repo_id, created_at DESC);

-- RLS ----------------------------------------------------------------------

ALTER TABLE heal_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS heal_feedback_scope ON heal_feedback;
CREATE POLICY heal_feedback_scope ON heal_feedback
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- Append-only from the app, like manifest_events
REVOKE UPDATE, DELETE ON heal_feedback FROM app_user;

COMMIT;
