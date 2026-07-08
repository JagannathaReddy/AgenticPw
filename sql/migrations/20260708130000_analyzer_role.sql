-- 20260708130000_analyzer_role.sql
-- Add 'analyzer' to manifests.role check constraint (L4 sprint A.1).
--
-- The analyzer reads recent rejected manifests, clusters them by failure
-- signature, and emits a Markdown report artifact. Read-only against
-- production data; suggests but never applies harness changes on its own.
-- Later A-sprints layer proposal generation, eval scoring, and PR-open on
-- top of the same role.
--
-- Per sql/migrations/README.md: role-check migrations are cumulative — this
-- constraint is a superset of every prior one so re-application from any
-- point in history stays valid.

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
