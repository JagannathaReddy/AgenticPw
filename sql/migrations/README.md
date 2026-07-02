# SQL migrations

Postgres 16 (Aurora) schema for the Q1 platform. Every migration is:

- **Forward-only** — no `DOWN` migrations in Q1 (they don't survive real-world rollback anyway)
- **Numbered** — `NNNN_short_name.sql`; NNNN is monotonic, never re-used
- **Idempotent where safe** — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
- **RLS-enabled** for every tenant-scoped table
- **Reviewed** — every migration PR needs two approvals (one from data owner P2, one from an unrelated eng)

## Runner

We use `node-pg-migrate` in raw-SQL mode (not the JS API). Command:

```bash
npm run db:migrate            # applies all pending migrations
npm run db:migrate:status     # shows applied vs. pending
npm run db:migrate:create foo # scaffolds NNNN_foo.sql
```

Runner tracks state in a `pgmigrations` table.

## Order of application (Q1)

| # | Name | Purpose |
|---|------|---------|
| 0001 | `orgs_and_workspaces.sql` | Root tenancy tables + IdP linkage |
| 0002 | `repositories.sql` | Per-workspace repos + profile pointer |
| 0003 | `manifests.sql` | Task manifest + events (event-sourced) |
| 0004 | `llm_calls_and_audit.sql` | LLM usage log + WORM audit log |
| 0005 | `memory_and_budgets.sql` | Learned flows + spend budgets |
| 0006 | `rls_policies.sql` | All RLS + tenant context helpers |
| 0007 | `pgvector_setup.sql` | Extension + embedding column |
| 0008 | `indexes.sql` | Performance indexes discovered during load test |

Numbers left free (0009+) for Q1 hot-fix migrations discovered during partner ramp.

## Tenant context — how RLS works

Every request handler sets these session-local variables **before the first query**:

```sql
SET LOCAL app.org_id = 'uuid-here';
SET LOCAL app.workspace_id = 'uuid-here';
```

RLS policies compare row values to these variables. If a policy check fails, Postgres returns zero rows — the app sees "not found," never leaks data across tenants.

**System jobs** (workers not tied to a user request) use a separate context:

```sql
SET LOCAL app.system_context = 'true';
```

Only a hand-audited allowlist of policies grant `USING (current_setting('app.system_context', true) = 'true')`. Everything else denies by default.

## Testing RLS

`sql/rls-tests/` contains a Jest suite that:

1. Creates two synthetic tenants A and B
2. Signs in as A, tries to read/write every table
3. Verifies A cannot see any of B's rows
4. Repeats the reverse
5. Runs the same tests as a "system" user without either `org_id` set — expects zero rows

The suite runs on every PR touching `sql/` or the tenancy code. A failure blocks the merge.

## Migration authoring checklist

- [ ] Migration filename follows `NNNN_snake_case.sql`
- [ ] Every new table has RLS enabled (or explicitly justified as global)
- [ ] Every RLS policy has an accompanying RLS test
- [ ] Any DROP or ALTER on an existing column is preceded by a data audit
- [ ] Migration is safe to run online (no long locks; use `CREATE INDEX CONCURRENTLY` for hot tables)
- [ ] PR body includes: purpose, backfill strategy, rollback plan
- [ ] `npm run db:migrate` succeeds against a fresh DB and against a copy of prod

## Anti-patterns

- ❌ Editing a migration file after it has been merged to `main`
- ❌ `DROP TABLE ... CASCADE` without a data-loss review
- ❌ New table without `workspace_id` (or explicit justification)
- ❌ Using `service_role` connections in application code (RLS bypass = data breach)
- ❌ Any `ALTER TYPE ... ADD VALUE` without checking replica behavior
- ❌ Multi-purpose "misc fix" migrations — one migration, one purpose

## Extensions used

- `pgcrypto` — `gen_random_uuid()` for primary keys
- `pgvector` — embedding columns for memory retrieval (Q1 installs, Q2 uses)
- `pg_stat_statements` — enabled on the RDS parameter group for perf visibility
