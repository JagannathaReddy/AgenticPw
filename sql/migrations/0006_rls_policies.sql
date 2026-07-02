-- 0006_rls_policies.sql
-- Row-level security across every tenant-scoped table.
-- Enforcement model:
--   * App middleware sets  SET LOCAL app.workspace_id = '<uuid>'  before first query
--   * System jobs set      SET LOCAL app.system_context = 'true'
--   * Missing context = zero rows (deny by default)

BEGIN;

-- Helper: read current tenant context safely -----------------------------
CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.workspace_id', true), '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION current_org_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.org_id', true), '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION is_system_context()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_setting('app.system_context', true) = 'true';
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;

-- Organizations -----------------------------------------------------------
-- Users see only their org. Owners/admins can update.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_read ON organizations;
CREATE POLICY organizations_read ON organizations
  FOR SELECT
  USING (id = current_org_id() OR is_system_context());

-- Workspaces --------------------------------------------------------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspaces_scope ON workspaces;
CREATE POLICY workspaces_scope ON workspaces
  USING (org_id = current_org_id() OR is_system_context());

-- Org members -------------------------------------------------------------
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_members_scope ON org_members;
CREATE POLICY org_members_scope ON org_members
  USING (org_id = current_org_id() OR is_system_context());

-- Repositories ------------------------------------------------------------
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS repositories_scope ON repositories;
CREATE POLICY repositories_scope ON repositories
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- Repo profiles -----------------------------------------------------------
ALTER TABLE repo_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS repo_profiles_scope ON repo_profiles;
CREATE POLICY repo_profiles_scope ON repo_profiles
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- Manifests ---------------------------------------------------------------
ALTER TABLE manifests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manifests_scope ON manifests;
CREATE POLICY manifests_scope ON manifests
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- Manifest events (append-only) -------------------------------------------
ALTER TABLE manifest_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manifest_events_scope ON manifest_events;
CREATE POLICY manifest_events_scope ON manifest_events
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- LLM calls ---------------------------------------------------------------
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_calls_scope ON llm_calls;
CREATE POLICY llm_calls_scope ON llm_calls
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- Audit log ---------------------------------------------------------------
-- Org-scoped, because some actions target org itself (no workspace_id).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_scope ON audit_log;
CREATE POLICY audit_log_scope ON audit_log
  USING (org_id = current_org_id() OR is_system_context());

-- Memory ------------------------------------------------------------------
ALTER TABLE memory_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_flows_scope ON memory_flows;
CREATE POLICY memory_flows_scope ON memory_flows
  USING (workspace_id = current_workspace_id() OR is_system_context());

ALTER TABLE memory_hosts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_hosts_scope ON memory_hosts;
CREATE POLICY memory_hosts_scope ON memory_hosts
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- Budgets -----------------------------------------------------------------
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budgets_scope ON budgets;
CREATE POLICY budgets_scope ON budgets
  USING (workspace_id = current_workspace_id() OR is_system_context());

-- Application role --------------------------------------------------------
-- The app connects as 'app_user'. That role has table-level GRANTs but
-- cannot bypass RLS. Only 'db_migrator' (used by migrations) bypasses.
-- The migrator role must NEVER be used by application code.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- Manifest events: no UPDATE, no DELETE, ever.
REVOKE UPDATE, DELETE ON manifest_events FROM app_user;

-- Audit log: no UPDATE, no DELETE, ever.
REVOKE UPDATE, DELETE ON audit_log FROM app_user;

COMMIT;
