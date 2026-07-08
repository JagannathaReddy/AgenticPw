-- 20260706120000_quarantiner_role.sql
-- Add 'quarantiner' to the manifests.role check constraint (Sprint 5).
-- The quarantiner wraps steward-flagged flaky tests in test.fixme via the
-- same dry-run → apply machinery as heals. Deterministic — no LLM calls.
--
-- Per sql/migrations/README.md: the earlier role-check migrations
-- (onboarding_role, improver_role) were updated in the same commit so their
-- allowed-value lists stay supersets and survive re-application.

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
