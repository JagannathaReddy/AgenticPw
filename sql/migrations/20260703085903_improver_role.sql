-- 20260703085903_improver_role.sql
-- Add 'improver' to the manifests.role check constraint (enh #19).

BEGIN;

ALTER TABLE manifests DROP CONSTRAINT IF EXISTS manifests_role_check;

ALTER TABLE manifests ADD CONSTRAINT manifests_role_check CHECK (
  role IN (
    'orchestrator', 'coverage', 'triage', 'steward',
    'onboarding', 'improver', 'quarantiner',
    'explorer', 'generator', 'healer', 'reviewer', 'judge'
  )
);

COMMIT;
