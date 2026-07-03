# test-agent — Agentic QA platform (local dev)

**Release:** `v0.2.0-triage` — see [docs/MILESTONE-C.md](docs/MILESTONE-C.md) (previous: [v0.1.0](docs/MILESTONE-STATUS.md)).

An AI teammate for existing Playwright suites. Describe a test in English → get code in your repo's style. Point it at a failing test → get a patched version that passes, or a clear refusal with a category. Watch your suite → get a health report (Milestone D, planned).

**Today's scope:** v0 runs on your laptop. Postgres in Docker, Node processes on host, Playwright on host, real LLM APIs (Anthropic or OpenAI). The path to cloud is scoped in [docs/Q1-TECHNICAL-DESIGN.md](docs/Q1-TECHNICAL-DESIGN.md) — it's designed for, not needed for, this quick start.

Full walkthrough with A/B evidence: [docs/DEMO.md](docs/DEMO.md).
Post-milestone retro: [docs/RETROSPECTIVE.md](docs/RETROSPECTIVE.md).

---

## Quick start (5 minutes)

**Prerequisites:** Node 22+, Docker, an `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

```bash
# 1. Install deps + start Postgres + apply migrations + seed dev tenant
npm install
npm run dev:up

# 2. Paste your API key
cp .env.example .env
$EDITOR .env           # set OPENAI_API_KEY (or ANTHROPIC_API_KEY)

# 3. Boot the API + worker (two processes, one command)
npm run dev
```

In another terminal:

```bash
# Onboard the repo — extract a RepoProfile in ~12s / ~$0.001
npm run agent -- init . --name my-repo

# Get its shortId
npm run agent -- repos

# Describe a test — get real Playwright code in your repo's style
npm run agent -- add \
  "Click Get Started on the Playwright home page and verify Installation heading is visible." \
  --url https://playwright.dev/ \
  --outcome "Installation heading is visible" \
  --max-steps 4 \
  --repo <shortId>

# When a test breaks — heal it (safe categories) or refuse (unsafe ones)
npm run agent -- heal tests/foo.spec.ts --repo <shortId>
```

Real Chromium opens. Real GPT-4o-mini writes / heals code. Real Playwright runs it. `succeeded` in ~20 seconds. See [docs/DEMO.md](docs/DEMO.md) for the full 4-part walkthrough with sample output.

---

## Layout

```
apps/
  api/                 Fastify HTTP surface (POST /v1/tests)
  worker/              In-process poll loop running Coverage workflow
packages/
  ops-types/           Shared TypeScript: TaskManifest, RepoProfile, LLM contract
  ops-prompts/         Prompt loader (YAML front-matter + Mustache render)
  eval-harness/        Golden-corpus regression runner for prompt changes
  rls-tests/           Postgres RLS isolation tests
  agent-server/        Legacy autonomous agent (Stagehand-driven, being sunsetted)
prompts/               Versioned prompts (system + user templates per role)
  explorer/  generator/  judge/  onboarding/  eval/
sql/migrations/        Postgres schema — RLS-first
scripts/               dev-up.sh, dev-migrate.sh, seed-dev-tenant.ts
tests/                 Playwright suites (the seed test that ships)
docs/                  Design docs (Q1 tech design, sequence diagrams, week plan)
infra/future/          Terraform for the cloud v1 target — parked
```

## npm scripts

| Command | What it does |
|---------|--------------|
| `npm run dev:up` | Start Postgres, apply migrations, seed dev tenant |
| `npm run dev` | Start API (:3000) + worker in parallel with tsx watch |
| `npm run db:up` | Just start Postgres |
| `npm run db:migrate` | Apply migrations to running Postgres |
| `npm run db:reset` | ⚠ drop + reapply everything (destroys volume) |
| `npm run db:seed` | Idempotently seed the dev tenant |
| `npm run typecheck` | Typecheck the whole monorepo |
| `npm run build` | Compile every workspace |
| `npm run test:rls` | Run cross-tenant isolation tests |
| `npm run test:playwright` | Run the Playwright suite (`tests/`) |
| `npm run eval` | Run the prompt eval harness against `prompts/eval/corpus/` |
| `npm run prompts:validate` | Parse every prompt front-matter; fails on malformed |

## Environment

Copy `.env.example` → `.env` and fill in what you need. The defaults in `.env.example` work as-is for the DB and dev-tenant flow. LLM keys are only required once real activities land (W3).

## How manifests flow (v0)

1. `POST /v1/tests` → API inserts `manifests` row with `status = pending`
2. Worker polls Postgres (`FOR UPDATE SKIP LOCKED`) → claims a manifest → sets `assigned`
3. `runCoverage` runs Explorer → Generator → Judge activities, appending to `manifest_events` after each stage
4. Terminal state (`succeeded` | `rejected` | `failed`) recorded on the manifest with a `result` JSON blob

Full sequence in [docs/Q1-SEQUENCE-DIAGRAMS.md](docs/Q1-SEQUENCE-DIAGRAMS.md#1-coverage--end-to-end).

## Multi-tenancy

The dev tenant is hardcoded (`DEV_ORG_ID`, `DEV_WORKSPACE_ID` in `.env`), but the RLS boundary is real. Every DB session opens with `SET LOCAL app.workspace_id = ...`. To prove isolation: `npm run test:rls`.

When we swap dev auth for WorkOS in v1, the middleware changes; the RLS policies do not.

## Design docs (recommended reading order)

1. [docs/README.md](docs/README.md) — legacy POC index
2. **[docs/Q1-TECHNICAL-DESIGN.md](docs/Q1-TECHNICAL-DESIGN.md)** — the v1 target architecture; v0 is a scoped subset
3. [docs/Q1-SEQUENCE-DIAGRAMS.md](docs/Q1-SEQUENCE-DIAGRAMS.md) — Mermaid sequence + state diagrams
4. [docs/Q1-WEEK-BY-WEEK-PLAN.md](docs/Q1-WEEK-BY-WEEK-PLAN.md) — 13-week execution plan (v1)

## Where things live that surprised us

- **Prompts are code.** [prompts/](prompts/) with YAML front-matter; loaded by [packages/ops-prompts](packages/ops-prompts/); hash goes into OTel spans; changes go through [prompts/VERSIONING.md](prompts/VERSIONING.md).
- **RLS is enforced by Postgres, not by the app.** Every table has policies. See [sql/migrations/0006_rls_policies.sql](sql/migrations/0006_rls_policies.sql).
- **The Task Manifest is the API between agents.** See [packages/ops-types/src/manifest.ts](packages/ops-types/src/manifest.ts).
- **Activities are boring functions.** No Temporal in v0. When v1 arrives, wrap each function as a Temporal activity — same signature.

## What's *not* here yet (deliberately)

- Real Explorer (Stagehand) — W3
- Real Generator (Anthropic SDK) — W3
- Real Judge (spawn Playwright) — W3
- GitHub App wiring (PR creation) — W4
- Repo Onboarding (profile extractor) — W4
- Heal / Triage — Q2

Each of these has a stub in `apps/worker/src/activities/*.ts` that we swap out in place; the workflow shape doesn't change.

## Legacy code

`packages/agent-server/` is the original POC autonomous agent. It still runs (see `docs/AUTONOMOUS-AGENT.md`) but is being sunsetted — its pieces (Stagehand runner, guardrails, quality checks) migrate into `apps/worker/src/activities/` over Weeks 3–5.
