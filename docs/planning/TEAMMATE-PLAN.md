# AgenticPw — Full Autonomous QA Teammate (Detailed Plan)

> **Status:** Planning · **Target:** v0.14.0-teammate  
> **Philosophy:** [Loop Engineering](https://github.com/cobusgreyling/loop-engineering) · [Addy Osmani](https://addyosmani.com/blog/loop-engineering/) · [LangChain four-loop stack](https://www.langchain.com/blog/the-art-of-loop-engineering)

---

## 1. Problem statement

**Today:** AgenticPw is a capable QA toolkit. Each command (`add`, `heal`, `steward`, `batch`) creates a single manifest and stops. A human must chain steps manually:

```
add → judge fails → heal → apply → steward → batch → apply → quarantine
```

**Target:** An **AI Teammate** — you assign intent once; the platform runs **closed loops** until done, budget exhausted, or escalation with evidence.

---

## 2. Loop Engineering mapping

### LangChain's four loops → AgenticPw

| Loop | Meaning | Today | Teammate target |
|------|---------|-------|-----------------|
| **L1 Agent** | Model + tools until done | Explorer, Generator, Healer, Steward | Unchanged — specialists stay |
| **L2 Verification** | Grader retries until pass | Judge (coverage); triage verify (heal) | Closed verify loops inside every assignment |
| **L3 Event-driven** | Cron/webhooks trigger runs | heal-on-failure.yml, suite-health.yml (disconnected) | Unified assignment router from CI + schedule |
| **L4 Hill-climb** | Traces improve harness | Feedback + eval harness (manual promote) | Surface low accept-rate; optional auto-promote |

### Greyling/Addy primitives → AgenticPw

| Primitive | Teammate implementation |
|-----------|-------------------------|
| **Automations** | Cron steward + CI failure → `POST /v1/assignments` |
| **Worktrees** | Phase 6: git worktree per assignment (v1 uses `tests/triaged/<id>/`) |
| **Skills** | RepoProfile + prompts/ + pgvector RAG |
| **Connectors** | API/CLI/web; Phase 5: Slack webhook |
| **Sub-agents** | Explorer/Generator vs Judge; Healer vs Classifier |
| **Memory** | Postgres: qa_assignments, steward history, feedback — not customer STATE.md |

---

## 3. Architecture

```
Surfaces (CLI / Web / CI / Cron)
        ↓
POST /v1/assignments
        ↓
Worker role=teammate → Assignment router
        ↓
┌─────────────┬──────────────┬─────────────┬──────────────┐
│ UserStory   │ Regression   │ React       │ HealthCheck  │
│ Loop        │ Loop         │ Loop        │ Loop         │
└─────────────┴──────────────┴─────────────┴──────────────┘
        ↓ (inline calls)
coverage · triage · steward · batch · quarantine
        ↓
teammate-report.json + qa_assignments status
        ↓
GET /v1/repos/:id/teammate (memory) · Web inbox
```

**Key decision:** New manifest **role `teammate`** with `goal.kind: teammate_assignment`. Child manifests link via `parent_manifest_id` for cost rollup and timeline UI.

---

## 4. Data model

### Migration: `sql/migrations/20260708120000_qa_assignments.sql`

- Table `qa_assignments`: id, workspace_id, manifest_id (unique FK), repo_id, assignment_type, title, status, priority, source, loop_state JSONB, escalation JSONB, timestamps
- assignment_type: `automate_story` | `regression` | `fix_failure` | `health_check`
- status: `active` | `needs_you` | `done` | `escalated` | `cancelled` | `failed`
- RLS on workspace_id

### Extend manifests role CHECK

Add `teammate` (same pattern as quarantiner migration).

### Extend `packages/ops-types/src/manifest.ts`

- Roles: teammate, onboarding, improver, quarantiner
- Goal kinds: teammate_assignment, suite_health, batch_heal, quarantine_flaky, improve_test
- Types: TeammateReport, TeammateEscalation, LoopState

### Artifact: `local-artifacts/<id>/teammate-report.json`

Phases array, childManifestIds, escalations, optional steward delta, totalCostUSD.

---

## 5. Loop specifications

### Loop A — UserStoryLoop (`automate_story`)

**Trigger:** `assign "<goal>" --url ... --outcome "..." --repo TAU`

1. Explorer → Generator → Judge (coverage phases)
2. Judge pass → L2 auto-apply or L1 dry-run done
3. Judge fail (healable) → heal retry 1..N → re-verify
4. Refused / max attempts → escalate

**Files:** `apps/worker/src/workflows/teammate/story-loop.ts`

**Defaults:** maxHealAttempts=3, maxCostUSD=2.00, trustRung=1

**Prerequisite:** Fix `runJudge` to use `loadRepoContext().repoRoot` (judge.ts:50)

### Loop B — RegressionLoop (`regression`)

**Trigger:** `assign --regression --repo TAU` or `agent qa`

1. Steward (K=3)
2. Classify healCandidates vs flaky vs env failures
3. Batch heal (safe categories only)
4. Optional quarantine (flaky)
5. Verify steward (second run)
6. Delta report before/after

**Files:** `apps/worker/src/workflows/teammate/regression-loop.ts`

**TAU:** Auth/setup failures → escalate `env_setup_required`, do not infinite-heal

### Loop C — ReactLoop (`fix_failure`)

**Trigger:** `assign --fix tests/foo.spec.ts` or CI webhook

Triage inline with heal retries → apply or escalate. Simplest loop — ship first.

**Files:** `apps/worker/src/workflows/teammate/react-loop.ts`

### Loop D — HealthCheckLoop (`health_check`)

**Trigger:** `assign --health` or weekly cron

Steward only → report → done.

---

## 6. Worker implementation

| File | Purpose |
|------|---------|
| `apps/worker/src/workflows/teammate.ts` | Entry router + report writer |
| `apps/worker/src/workflows/teammate/story-loop.ts` | UserStoryLoop |
| `apps/worker/src/workflows/teammate/regression-loop.ts` | RegressionLoop |
| `apps/worker/src/workflows/teammate/react-loop.ts` | ReactLoop |
| `apps/worker/src/workflows/teammate/health-loop.ts` | HealthCheckLoop |
| `apps/worker/src/workflows/teammate/escalate.ts` | Shared escalation |
| `apps/worker/src/workflows/teammate/budget.ts` | Child cost rollup |

Update `apps/worker/src/index.ts`: claim `teammate` role, dispatch `runTeammate`.

---

## 7. API

### `apps/api/src/routes/assignments.ts`

| Method | Path |
|--------|------|
| POST | `/v1/assignments` |
| GET | `/v1/assignments` |
| GET | `/v1/assignments/:id` |
| POST | `/v1/assignments/:id/cancel` |
| GET | `/v1/assignments/:id/report` |

### `apps/api/src/routes/teammate-state.ts`

GET `/v1/repos/:id/teammate` — last steward, active assignments, escalations, feedback stats, loop readiness score.

---

## 8. CLI (`scripts/test-agent.ts`)

```bash
npm run agent -- assign "<title>" --url <url> --outcome "..." --repo <shortId>
npm run agent -- assign --regression --repo <shortId>
npm run agent -- assign --fix <testPath> --repo <shortId>
npm run agent -- assign --health --repo <shortId>
npm run agent -- qa --repo <shortId>              # alias regression
npm run agent -- inbox [--status needs_you]
npm run agent -- assignment <id>
npm run agent -- cancel <assignmentId>
```

---

## 9. Web console

| Route | Purpose |
|-------|---------|
| `/teammate` | Inbox |
| `/teammate/assign` | Unified assign form |
| `/teammate/[id]` | Loop timeline + apply/feedback |

- Sidebar: Teammate nav item
- Dashboard: "Needs your attention" card
- Repos: primary CTA "Assign regression"

Store: `fetchAssignments`, `submitAssignment`, `fetchTeammateState`

---

## 10. Trust & escalation

| Rung | Behavior |
|------|----------|
| L1 | Diffs only; human apply |
| L2 | `--auto-apply` verified heals |
| L3 | CI opens PR |

Never auto-loop: product_bug, weakens_assertion, touches_auth, env_setup_required.

Escalated → `qa_assignments.status = needs_you`.

---

## 11. Phases & estimates

| Phase | Scope | Days |
|-------|-------|------|
| **0** | Fix runJudge repoRoot, judge-runner parity, sync types | 0.5 |
| **1** | Schema + ReactLoop + assign API + CLI inbox + web inbox | 2–3 |
| **2** | UserStoryLoop + heal retries + story alias | 3–4 |
| **3** | RegressionLoop + qa alias + TAU demo | 2–3 |
| **4** | Teammate memory API + dashboard + loop-readiness doctor | 2 |
| **5** | CI assign, scheduled regression, webhook | 2 |
| **6** | Auth bootstrap, worktrees, utility generation | ongoing |

**Recommended start:** Phase 0 → Phase 1 (proves plumbing) → Phase 3 (TAU regression demo) → Phase 2 (user story automation).

---

## 12. Success criteria

1. One command: `agent assign --regression --repo TAU` → single report
2. Console inbox shows active work and escalations
3. Story loop: assign → heal retries → pass or escalate (no manual heal)
4. TAU: auth failures escalated; healable issues get diffs
5. Loop readiness score on repo page
6. Per-phase cost in every assignment report

---

## 13. Out of scope (v1)

- PR babysitter / dependency sweeper loops
- Unbounded Stagehand without Playwright verify
- Customer-repo LOOP.md / STATE.md
- Multi-worker parallel assignments
- Hosted sandboxed browser pool
- L4–L5 auto-merge

---

## 14. Current codebase gaps (audit)

| Gap | Location |
|-----|----------|
| Judge uses wrong repo root | `apps/worker/src/activities/judge.ts:50` |
| Coverage rejects on first judge fail | `apps/worker/src/workflows/coverage.ts:203` |
| No heal retry in triage | `apps/worker/src/workflows/triage.ts` (single attempt) |
| No unified assignment API | 7 separate POST routes |
| No qa_assignments table | — |
| Types drift from DB | `packages/ops-types/src/manifest.ts` |
| Worker doesn't claim teammate role | `apps/worker/src/index.ts:36` |
