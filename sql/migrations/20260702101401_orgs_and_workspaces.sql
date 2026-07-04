-- 20260702101401_orgs_and_workspaces.sql
-- Root tenancy: organizations own workspaces; workspaces are the RLS boundary.
-- IdP linkage lives on the organization (single WorkOS org per contract).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Organizations -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  plan         TEXT NOT NULL DEFAULT 'design_partner'
                 CHECK (plan IN ('design_partner', 'starter', 'pro', 'enterprise')),
  workos_org_id TEXT UNIQUE,               -- WorkOS org id; nullable during self-serve pilot
  data_region  TEXT NOT NULL DEFAULT 'us-east-1'
                 CHECK (data_region IN ('us-east-1', 'eu-west-1')),
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'paused', 'terminated')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizations_workos_org_id_idx
  ON organizations (workos_org_id) WHERE workos_org_id IS NOT NULL;

-- Workspaces ---------------------------------------------------------------
-- A workspace is the smallest tenant boundary. All manifests, memory, and
-- audit rows are workspace-scoped.
CREATE TABLE IF NOT EXISTS workspaces (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name                      TEXT NOT NULL,
  github_installation_id    BIGINT UNIQUE,           -- one GitHub App install per workspace
  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'onboarding', 'review', 'active', 'paused')),
  trust_rung                SMALLINT NOT NULL DEFAULT 1
                              CHECK (trust_rung BETWEEN 1 AND 5),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS workspaces_org_id_idx ON workspaces (org_id);
CREATE INDEX IF NOT EXISTS workspaces_github_install_idx
  ON workspaces (github_installation_id) WHERE github_installation_id IS NOT NULL;

-- Memberships --------------------------------------------------------------
-- Users belong to organizations; access to workspaces is inherited (Q1) or
-- explicitly granted (Q2). Q1 model: any org member reaches every workspace.
CREATE TABLE IF NOT EXISTS org_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,                     -- WorkOS user id
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_members_user_idx ON org_members (user_id);

-- Triggers -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_touch ON organizations;
CREATE TRIGGER organizations_touch
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS workspaces_touch ON workspaces;
CREATE TRIGGER workspaces_touch
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
