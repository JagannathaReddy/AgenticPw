# Retrospective — v0.1.0-local-q1

Honest post-mortem after shipping local Q1. Written after real runs, real bugs, real numbers — not from a plan doc.

---

## What worked (much better than expected)

### 1. Design-first, then local-first

The order was: (a) full PRD, (b) production tech design doc, (c) prompt schemas + SQL schema + task-manifest contract, (d) *then* pivot to local execution. The pivot took about **an hour of doc-annotation** and lost nothing meaningful. Every future cloud swap is one interface implementation, not a rewrite.

**Verdict:** design → scaffold → run is much cheaper than "start hacking, refactor later." Even in a solo session.

### 2. Task Manifest as the contract

The `TaskManifest` type ended up carrying almost the entire product's semantics — role, state, goal params, budget, policy, audit. When a new workflow was added (Onboarding), the manifest shape didn't change — only the `role` enum and `goal.params`. That's the property good contracts have: additions don't require modifying them.

**Verdict:** the manifest survives the transition to Temporal (`workflowId` field is already there) and to multi-tenant SaaS (all tenant fields are already in the shape). Keep it.

### 3. Refuse-to-ship as a first-class outcome

Judge returning `rejected` with a `category` (rather than always trying to fix or always succeeding) is the property that keeps the platform trustworthy. Real evidence: in the 3-run Milestone A shakedown, 2 rejections were legitimate (agent couldn't verify meta-properties, dynamic UI too complex). Both would have shipped broken code if we'd tried to force success.

**Verdict:** design future Triage around expanding the *refuse* categories, not shrinking them.

### 4. Structured logs from the start

Every worker log line has `manifestId`, `correlationId`, `manifestShortId`, and typed fields like `cost_usd` and `tokens_in`. Went from raw `stderr.write` to pino in one commit and it made incident triage 10× easier. Loki-ready without any changes.

**Verdict:** structured logs are non-negotiable even in local dev.

### 5. RLS test suite as the tenancy backstop

Once we caught the "platform role bypasses RLS" bug during actual test execution, we discovered that RLS enforcement had never been proven end to end. Fixing it took 30 minutes; the peace of mind is worth days.

**Verdict:** RLS tests are one of the highest ROI investments in the whole session.

---

## What was harder than expected

### 1. Postgres `SET LOCAL` doesn't accept bound parameters

Every early smoke test failed silently with `syntax error at or near "$1"`. The fix (`SELECT set_config('app.workspace_id', $1, true)`) is standard, but the failure mode gave no useful signal until we added structured logs and read the actual DB error.

**Lesson:** whenever you can, test the DB layer against real Postgres, not in-memory shims. This bug would have been caught in the first real query.

### 2. Node stdout is block-buffered under nohup

Multiple times, worker "seemed" hung when it was actually working fine — its "Running manifest" log was buffered because stdout was redirected to a file. Switching to stderr (line-buffered) fixed it.

**Lesson:** always route worker logs to stderr, always use structured logs, never rely on `console.log` for observability.

### 3. Idempotent migrations

Bare `CREATE TRIGGER`, `ALTER TABLE ADD CONSTRAINT`, `CREATE POLICY` all fail on re-apply. Made every one idempotent (`DROP TRIGGER IF EXISTS`, `DO $$ BEGIN IF NOT EXISTS ... END $$;`).

**Lesson:** the db-migrate script should track applied migrations (like node-pg-migrate does). Reapplying via file scan is a footgun. Track in a `pgmigrations` table.

### 4. The a11y outcome verifier was over-strict

Meta-outcomes like "title contains Playwright" and "search results are visible" tripped the verifier because words like *title*, *contains*, *visible* rarely appear literally in the a11y tree. Relaxed to trust the agent + record verifier for observability.

**Lesson:** verify against on-screen text, not against the outcome's exact wording. Q2's Reviewer agent can add strictness where it matters.

### 5. LLM output structure

GPT-4o-mini reliably followed `===FILE: ...===` markers but occasionally wrapped blocks in stray markdown fences. The parser handles both. Also, models occasionally reused example filenames from few-shot prompts — added a rule to derive filenames from the goal.

**Lesson:** the parser has to tolerate a wider range of "close but not exact" LLM outputs than you'd guess.

---

## Real bugs found by actually running

Cataloged for future incident post-mortems:

| # | Bug | Category | Where found |
|---|-----|----------|-------------|
| 1 | Native pg on 5432 shadows Docker's Docker's | env | First seed-tenant run |
| 2 | `SET LOCAL app.x = $1` fails | schema/query | First POST /v1/tests |
| 3 | Non-idempotent migrations | schema | Second dev-up.sh run |
| 4 | Worker BEGIN wrapped whole flow → invisible progress | design | First real Explorer smoke |
| 5 | Nohup stdout block-buffered → apparent hangs | env | First long-running Explorer |
| 6 | Prompt loader renders both files with one variable bag | design | First real Explorer smoke |
| 7 | Model forgot to import `expect` in POM | prompt | Day 3 Judge smoke |
| 8 | Model reused example filenames from few-shot | prompt | Day 4 shakedown |
| 9 | Generated spec imported renamed page object path | design | Day 3 Judge smoke |
| 10 | Playwright JSON reporter has preamble before `{` | LLM-adjacent | Day 3 Judge smoke |
| 11 | `platform` role is superuser → bypasses RLS silently | schema | Real RLS test run |
| 12 | Cleanup FK ordering | schema | RLS test cleanup |
| 13 | `manifests_role_check` didn't include `onboarding` | schema | First `test-agent init` |
| 14 | Prompt loader defaults to `system.md` — judge/onboarding had different filenames | prompt | Onboarding first run |
| 15 | Old queued manifests without target_url crash-looped | data | Post-DB-reset boot |
| 16 | Coverage triples reference role `coverage` which has no prompt dir | eval | First real eval |

Each one caught only by *running the code*. None by reading it. Number of typecheck errors caught during the same time: near zero (TS is strong here, but the bugs aren't in the shape of types).

**Lesson:** the value of a working local end-to-end far exceeds the value of a good typecheck. Ship, run, fix, repeat.

---

## Design decisions that held up

- **Event-sourced `manifest_events`** — every debugging session used this table. It's the ground truth. Keep it append-only.
- **Prompt hash in every span + artifact** — enabled "which prompt did this run use?" queries trivially.
- **`ArtifactStore` interface** — trivial to swap for S3 later; no code changes needed elsewhere.
- **Manifest-scoped subdirectory for generated files** — solved the import-path issue and doubles as an isolation boundary between runs.
- **`refuseCategories` in `ManifestPolicy`** — even though we don't gate on them yet, they'll be the input to Milestone C's Triage.
- **Splitting `withTenant` transactions per workflow phase** — the pattern that lets us stream progress mid-run without giving up ACID.

---

## Design decisions to revisit

### 1. Single dev tenant hardcoded in every service's env

Works, but every place that uses `DEV_WORKSPACE_ID` is a future replace-with-JWT-decode site. Consolidate into a single `dev-auth.ts` module before Milestone C touches auth.

### 2. RAG picker over `tests/` cwd

Currently `pickFewShotExamples` walks `tests/` relative to `repoRoot`. That's fine for single-repo, but when we onboard multiple repos, we need per-repo test corpora. Small refactor, but do it before we support multiple onboarded repos.

### 3. Filename rename logic in Generator

`scopeToSubdir` mutates the paths the model emitted. It works because relative imports still resolve within the moved directory. But it's fragile — a model that emits absolute imports would break. Add a static-check step: `tsc --noEmit` on the generated files before Judge.

### 4. Prompt storage as loose files

`prompts/` is fine for a solo/small-team dev flow. But there's no versioning, no A/B, no per-tenant overrides. Q2's Prompt Registry service (per `Q1-TECHNICAL-DESIGN.md`) is the fix. Don't scale the current pattern past ~15 prompts.

### 5. In-process worker

Fine for local. But we now have real evidence that when it crashes mid-flow, the manifest is left in `in_progress` and requires manual cleanup. The `WORKER_RESET_STALE` flag helps but isn't robust — a real Temporal migration path is the fix. Do this when we start hitting concurrency (Milestone C runs Judge and Triage in parallel).

---

## Numbers

Numbers from actual runs during this session:

| Metric | Value |
|--------|-------|
| Migrations shipped | 10 |
| Workspaces in the monorepo | 7 (`apps/api`, `apps/worker`, 5 packages) |
| Real activities (Explorer, Generator, Judge, Onboarding) | 4 |
| CI jobs | 5 (typecheck, unit, prompts, RLS, seed test) |
| RLS tests passing | 9 / 9 |
| Unit tests passing | 14 (5 verify-outcomes + 9 parser) |
| Eval baseline triples runnable | 2 (judge role) |
| Real LLM cost per Coverage run | $0.0013 – $0.0015 |
| Real LLM cost per Onboarding run | $0.0008 |
| Real Coverage p95 duration (limited data) | ~21 s |
| Real Onboarding duration | ~12 s |
| Prompts shipped | 7 (`explorer/` × 2, `generator/` × 2, `judge/`, `onboarding/` × 2) |
| Postgres tables | 13 with RLS |

Deferred but scaffolded: `test_file_embeddings` (pgvector), `convention-classifier.md` prompt.
(The legacy `packages/agent-server` POC was removed in the post-v0.2.0 cleanup.)

---

## Costs during this session (rough)

I don't have exact totals, but from the manifests we ran end to end during dev:

- ~15 successful Coverage runs × ~$0.0014 ≈ **$0.02**
- ~5 Onboarding runs × ~$0.0008 ≈ **$0.004**
- ~5 rejected runs (still cost inference) × ~$0.0015 ≈ **$0.008**
- Eval baseline capture × 2 real judge calls ≈ **$0.0004**

**Total inference cost for the entire local Q1 build:** roughly **$0.03**. Would fund a company demo indefinitely.

---

## Notes for Milestone C (Triage)

When we start on heal-failing-tests:

- **Start from the categories we already refuse on.** `test_failed` and `outcome_not_asserted` are the categories where healing is safe. `product_bug` and `weakens_assertion` should stay rejections forever.
- **Reuse the LLM shim.** Just a new task class (`generate` → `heal`) and a different prompt.
- **Refuse-to-heal is a feature.** The Triage Agent's most valuable output on a broken test is often "this is a product bug, not a test bug" — captured, exit, notify.
- **Add a `heal` role to the manifests_role_check migration** *before* the first heal manifest, not after (same lesson as onboarding).

---

## The one thing I'd change if starting over

**Ship the migration runner (with tracking table) before the second migration.**

`db-migrate.sh` re-applying migrations from a file scan bit us at least 3 times during the session. Idempotent migrations are a band-aid. `node-pg-migrate` in raw-SQL mode would have made every subsequent bug easier to isolate.

Do this on day 1 of Milestone C. It's under an hour of work and pays for itself the next week.
