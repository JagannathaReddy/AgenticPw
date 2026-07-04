# SQL migrations

Postgres 16 + pgvector, running in Docker (`docker compose up -d postgres`,
container `test-agent-postgres`, host port 5433). Every migration is:

- **Forward-only** — no `DOWN` migrations (they don't survive real-world rollback anyway)
- **Timestamp-prefixed** — `YYYYMMDDHHMMSS_short_name.sql`; lexicographic order
  is chronological order, and parallel branches can't collide on a sequence number
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
   onboarding_role/improver_role) is re-applied against rows created under newer constraints —
   its allowed-value list has to include everything later migrations allow,
   or the re-run fails. This bit us once; see the comment in onboarding_role.

A tracked-state runner (node-pg-migrate style) is the known upgrade when
this becomes painful — [RETROSPECTIVE.md](../../docs/milestones/RETROSPECTIVE.md)
records the lesson.

## Order of application

| Timestamp | Name | Purpose |
|-----------|------|---------|
| 20260702101401 | `orgs_and_workspaces` | Root tenancy tables + IdP linkage |
| 20260702101402 | `repositories` | Per-workspace repos + profile pointer |
| 20260702101403 | `manifests` | Task manifest + events (event-sourced) |
| 20260702101404 | `llm_calls_and_audit` | LLM usage log + append-only audit log |
| 20260702101405 | `memory_and_budgets` | Learned flows + spend budgets |
| 20260702101406 | `rls_policies` | All RLS + tenant context helpers + `app_user` grants |
| 20260702101407 | `pgvector_setup` | vector extension + test-file embeddings |
| 20260702101408 | `performance_indexes` | Composite indexes for the hot query paths |
| 20260703085901 | `repositories_local_path` | Local-filesystem repos: nullable `github_repo_id`, `local_path` |
| 20260703085902 | `onboarding_role` | +`onboarding` in the manifests role check |
| 20260703085903 | `improver_role` | +`improver` in the manifests role check (#19) |
| 20260704004800 | `steward_runs` | `suite_runs` + `test_results` for flake analysis (Milestone D) |
| 20260704101500 | `heal_feedback` | Human verdicts on heals, feeds the healer prompt (#16) |

Timestamps are the file's first-commit time. New migrations: use `date +%Y%m%d%H%M%S` at authoring time.

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

- [ ] Filename follows `YYYYMMDDHHMMSS_snake_case.sql` and says what it touches
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
