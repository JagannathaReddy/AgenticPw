-- 0010_onboarding_role.sql
-- Add 'onboarding' to the manifests.role check constraint.

BEGIN;

ALTER TABLE manifests DROP CONSTRAINT IF EXISTS manifests_role_check;

ALTER TABLE manifests ADD CONSTRAINT manifests_role_check CHECK (
  role IN (
    'orchestrator', 'coverage', 'triage', 'steward',
    'onboarding',
    'explorer', 'generator', 'healer', 'reviewer', 'judge'
  )
);

COMMIT;
