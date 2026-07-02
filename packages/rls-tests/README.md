# RLS test suite

Every merge to `main` runs this suite against a fresh Postgres with all migrations from [`sql/migrations/`](../../sql/migrations/) applied. A failure blocks the merge — cross-tenant leakage is the platform's existential risk (design doc §11 R5).

## What it tests

1. **Deny-by-default** — a session with no tenant context sees zero rows in tenant-scoped tables.
2. **Positive scope** — a session set to tenant A sees A's rows and only A's rows.
3. **Cross-tenant isolation** — a session set to tenant A **cannot** read, write, update, or delete rows belonging to tenant B, on **every** tenant-scoped table.
4. **System context** — `SET LOCAL app.system_context = 'true'` grants read access; the app must never use this context for user-driven requests.
5. **Append-only guarantee** — `manifest_events` and `audit_log` reject UPDATE and DELETE from `app_user`.

## Running locally

```bash
# 1. Start a Postgres 16 (Aurora-compatible). Docker suggested:
docker run --rm -d --name rls-pg \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=platform \
  -p 5432:5432 \
  postgres:16

# 2. Apply migrations
export DATABASE_URL=postgres://postgres:test@localhost:5432/platform
bash packages/rls-tests/scripts/reset-db.sh

# 3. Run the suite
npm run test --workspace=@poc/rls-tests
```

Expected output:

```
✓ deny-by-default: no tenant context returns zero rows
✓ positive scope: workspace A sees only A's rows
✓ cross-tenant read: workspace B cannot see A's manifests
✓ cross-tenant write: workspace B cannot insert into A's workspace_id
✓ cross-tenant update: workspace B cannot update A's rows
✓ system context: reads across workspaces (audited path)
✓ append-only: manifest_events UPDATE is denied
✓ append-only: audit_log DELETE is denied
```

## CI integration

`.github/workflows/rls.yml` (to be added in Q1 W2) runs this suite:
- On every PR touching `sql/**`, `packages/rls-tests/**`, or code that sets tenant context
- Nightly against main (drift detection)
- With verbose output on failure so the reviewer sees which policy failed

## Adding a new tenant-scoped table

When you add a migration that creates a tenant-scoped table:

1. Add RLS to the migration (`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`)
2. Add a test case to `src/tables.test.ts` for the new table
3. Verify the suite still passes locally
4. Reviewer checks that the new policy exists and the test was added

## What this suite does NOT test

- Application-layer bugs (missing `SET LOCAL` in middleware). Covered by integration tests in `apps/api`.
- OPA policy correctness. Covered by policy-engine tests in Q2.
- Encryption at rest. Verified via infra tests + AWS documentation.

The suite is a **defense in depth** for the database. It cannot fix a missing tenant context — that's the app's job — but it guarantees that even if the app fails, Postgres refuses to leak.
