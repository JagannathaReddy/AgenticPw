-- 20260703085901_repositories_local_path.sql
-- v0 dev supports repos that live on the local filesystem (no GitHub install)
-- and therefore have no numeric github_repo_id. Make the column nullable and
-- keep uniqueness only for rows that actually have an id (via partial index).
--
-- Also add a local_path column so the OnboardingWorkflow can find files.

BEGIN;

ALTER TABLE repositories
  ALTER COLUMN github_repo_id DROP NOT NULL;

ALTER TABLE repositories
  DROP CONSTRAINT IF EXISTS repositories_github_repo_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS repositories_github_repo_id_unique
  ON repositories (github_repo_id)
  WHERE github_repo_id IS NOT NULL;

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS local_path TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS repositories_workspace_local_path_unique
  ON repositories (workspace_id, local_path)
  WHERE local_path IS NOT NULL;

COMMIT;
