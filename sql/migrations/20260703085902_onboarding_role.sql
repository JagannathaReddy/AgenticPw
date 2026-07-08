-- 20260703085902_onboarding_role.sql
-- Add 'onboarding' to the manifests.role check constraint.
--
-- Migrations here are re-applied wholesale on every dev-migrate, so this
-- list must stay a superset of every role that later migrations (improver_role onward)
-- allow — otherwise re-running this file against a live DB fails on rows
-- created under the newer constraint.

BEGIN;

ALTER TABLE manifests DROP CONSTRAINT IF EXISTS manifests_role_check;

ALTER TABLE manifests ADD CONSTRAINT manifests_role_check CHECK (
  role IN (
    'orchestrator', 'coverage', 'triage', 'steward', 'teammate', 'analyzer',
    'onboarding', 'improver', 'quarantiner',
    'explorer', 'generator', 'healer', 'reviewer', 'judge'
  )
);

COMMIT;
