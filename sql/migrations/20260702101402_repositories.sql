-- 20260702101402_repositories.sql
-- Onboarded GitHub repos + extracted style profile.
-- One repo lives in exactly one workspace.

BEGIN;

CREATE TABLE IF NOT EXISTS repositories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  full_name           TEXT NOT NULL,                     -- "owner/repo"
  default_branch      TEXT NOT NULL DEFAULT 'main',
  github_repo_id      BIGINT NOT NULL,                   -- GitHub numeric id
  status              TEXT NOT NULL DEFAULT 'onboarding'
                        CHECK (status IN ('onboarding', 'review', 'active', 'paused', 'archived')),
  profile_id          UUID,                              -- FK set after 0002 profile insert
  test_agent_yaml_sha TEXT,                              -- hash of any repo-side test-agent.yaml
  onboarded_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, full_name),
  UNIQUE (github_repo_id)
);

CREATE INDEX IF NOT EXISTS repositories_workspace_idx
  ON repositories (workspace_id, status);

-- Repo profile: the extracted conventions doc from OnboardingWorkflow.
CREATE TABLE IF NOT EXISTS repo_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL,                     -- denormalized for RLS
  conventions     JSONB NOT NULL,                    -- see prompts/onboarding/profile-extractor.md
  extracted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  extractor_version TEXT NOT NULL,                   -- e.g., "onboarding.profile-extractor.v1"
  confidence      NUMERIC(4, 3),                     -- 0..1 from extractor
  approved_by     TEXT,                              -- WorkOS user_id who confirmed
  approved_at     TIMESTAMPTZ,
  UNIQUE (repo_id, extracted_at)
);

CREATE INDEX IF NOT EXISTS repo_profiles_repo_idx ON repo_profiles (repo_id);
CREATE INDEX IF NOT EXISTS repo_profiles_workspace_idx ON repo_profiles (workspace_id);

-- Now that repo_profiles exists we can set the FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'repositories_profile_id_fk'
  ) THEN
    ALTER TABLE repositories
      ADD CONSTRAINT repositories_profile_id_fk
      FOREIGN KEY (profile_id) REFERENCES repo_profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Trigger for touch
DROP TRIGGER IF EXISTS repositories_touch ON repositories;
CREATE TRIGGER repositories_touch
  BEFORE UPDATE ON repositories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
