-- 20260708120000_teammate_and_qa_assignments.sql
-- Teammate role + human-facing assignment inbox for closed QA loops.

BEGIN;

ALTER TABLE manifests DROP CONSTRAINT IF EXISTS manifests_role_check;

ALTER TABLE manifests ADD CONSTRAINT manifests_role_check CHECK (
  role IN (
    'orchestrator', 'coverage', 'triage', 'steward', 'teammate', 'analyzer',
    'onboarding', 'improver', 'quarantiner',
    'explorer', 'generator', 'healer', 'reviewer', 'judge'
  )
);

CREATE TABLE IF NOT EXISTS qa_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  manifest_id      UUID NOT NULL UNIQUE REFERENCES manifests(id) ON DELETE CASCADE,
  repo_id          UUID NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  assignment_type  TEXT NOT NULL CHECK (assignment_type IN (
    'automate_story', 'regression', 'fix_failure', 'health_check'
  )),
  title            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'needs_you', 'done', 'escalated', 'cancelled', 'failed'
  )),
  priority         INT NOT NULL DEFAULT 0,
  source           TEXT NOT NULL DEFAULT 'human' CHECK (source IN (
    'human', 'ci', 'schedule', 'api'
  )),
  loop_state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  escalation       JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS qa_assignments_repo_status_idx
  ON qa_assignments (repo_id, status);
CREATE INDEX IF NOT EXISTS qa_assignments_workspace_created_idx
  ON qa_assignments (workspace_id, created_at DESC);

DROP TRIGGER IF EXISTS qa_assignments_touch ON qa_assignments;
CREATE TRIGGER qa_assignments_touch
  BEFORE UPDATE ON qa_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE qa_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qa_assignments_scope ON qa_assignments;
CREATE POLICY qa_assignments_scope ON qa_assignments
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

COMMIT;
