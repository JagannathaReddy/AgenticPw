# SQL migrations

Postgres 16 + pgvector, running in Docker (`docker compose up -d postgres`,
container `test-agent-postgres`, host port 5433). Every migration is:

- **Forward-only** — no `DOWN` migrations (they don't survive real-world rollback anyway)
- **Numbered** — `NNNN_short_name.sql`; NNNN is monotonic, never re-used
- **Idempotent** — `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + recreate, etc.
- **RLS-enabled** for every tenant-scoped table

## Runner

`scripts/db-migrate.sh` (behind `npm run db:migrate`) applies **every file in
filename order on every run** via `docker exec psql`. There is no tracking
table — idempotency is the mechanism, not bookkeeping.

Two consequences to internalize before authoring:

1. **Every migration must be safe to re-run against a live schema.** Guard
   creations with `IF NOT EXISTS`; recreate policies with `DROP POLICY IF
   EXISTS` first.
2. **Constraint-replacing migrations must stay supersets of later state.**
   A `DROP CONSTRAINT` + `ADD CONSTRAINT` (like the role-check migrations
   0010/0011) is re-applied against rows created under newer constraints —
   its allowed-value list has to include everything later migrations allow,
   or the re-run fails. This bit us once; see the comment in 0010.

A tracked-state runner (node-pg-migrate style) is the known upgrade when
this becomes painful — [RETROSPECTIVE.md](../../docs/RETROSPECTIVE.md)
records the lesson.

## Order of application

| # | Name | Purpose |
|---|------|---------|
| 0001 | `orgs_and_workspaces.sql` | Root tenancy tables + IdP linkage |
| 0002 | `repositories.sql` | Per-workspace repos + profile pointer |
| 0003 | `manifests.sql` | Task manifest + events (event-sourced) |
| 0004 | `llm_calls_and_audit.sql` | LLM usage log + append-only audit log |
| 0005 | `memory_and_budgets.sql` | Learned flows + spend budgets |
| 0006 | `rls_policies.sql` | All RLS + tenant context helpers + `app_user` grants |
| 0007 | `pgvector_setup.sql` | vector extension + test-file embeddings |
| 0008 | `performance_indexes.sql` | Composite indexes for the hot query paths |
| 0009 | `repositories_local_path.sql` | Local-filesystem repos: nullable `github_repo_id`, `local_path` |
| 0010 | `onboarding_role.sql` | +`onboarding` in the manifests role check |
| 0011 | `improver_role.sql` | +`improver` in the manifests role check (#19) |
| 0012 | `steward_runs.sql` | `suite_runs` + `test_results` for flake analysis (Milestone D) |
| 0013 | `heal_feedback.sql` | Human verdicts on heals, feeds the healer prompt (#16) |

## Tenant context — how RLS works

Every request handler sets these session-local variables **before the first query**:

```sql
SET LOCAL app.org_id = 'uuid-here';
SET LOCAL app.workspace_id = 'uuid-here';
```

RLS policies compare row values to these variables. If a policy check fails,
Postgres returns zero rows — the app sees "not found," never leaks data
across tenants.

**System jobs** (the worker's claim loop) use a separate context:

```sql
SET LOCAL app.system_context = 'true';
```

Only the policies that need it grant
`USING (current_setting('app.system_context', true) = 'true')`. Everything
else denies by default.

## Testing RLS

`packages/rls-tests/` (node:test, `npm run test:rls`) creates two synthetic
tenants, proves neither can read/write the other's rows across the
tenant-scoped tables, and checks the append-only guarantees (UPDATE/DELETE
revoked from `app_user` on `manifest_events`, `audit_log`, `suite_runs`,
`test_results`, `heal_feedback`).

## Migration authoring checklist

- [ ] Filename follows `NNNN_snake_case.sql` and says what it touches
- [ ] Safe to re-run against a live schema (see Runner above)
- [ ] Every new table has RLS enabled (or explicitly justified as global)
- [ ] Every RLS policy has an accompanying test in `packages/rls-tests/`
- [ ] Append-only tables REVOKE UPDATE/DELETE from `app_user`
- [ ] `npm run db:migrate` succeeds against a fresh DB **and** re-run against the current one

## Anti-patterns

- ❌ `DROP TABLE ... CASCADE` without a data-loss review
- ❌ New tenant-scoped table without `workspace_id`
- ❌ Bypassing RLS with a superuser connection in application code
- ❌ Multi-purpose "misc fix" migrations — one migration, one purpose
- ❌ Constraint lists that don't survive re-application (see Runner, point 2)

## Extensions used

- `pgcrypto` — `gen_random_uuid()` for primary keys
- `pgvector` — embedding columns for memory retrieval (installed, unused until semantic RAG lands)
