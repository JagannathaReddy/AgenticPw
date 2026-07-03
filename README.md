# test-agent — Agentic QA platform (local dev)

**Release:** `v0.2.0-triage` — see [docs/MILESTONE-C.md](docs/MILESTONE-C.md) (previous: [v0.1.0](docs/MILESTONE-STATUS.md)).

An AI teammate for existing Playwright suites. Describe a test in English → get code in your repo's style. Point it at a failing test → get a patched version that passes, or a clear refusal with a category. Watch your suite → get a health report (Milestone D, planned).

**Runs on a laptop.** Postgres in Docker, Node processes on host, Playwright on host, real LLM APIs (Anthropic or OpenAI). The path to cloud is scoped in [docs/Q1-TECHNICAL-DESIGN.md](docs/Q1-TECHNICAL-DESIGN.md) — it's designed for, not needed for, this quick start.

- Full walkthrough with A/B evidence: [docs/DEMO.md](docs/DEMO.md)
- Recording script for sharing with QA leads: [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md)
- Outreach + feedback: [docs/OUTREACH-KIT.md](docs/OUTREACH-KIT.md) · [docs/FEEDBACK-CAPTURE.md](docs/FEEDBACK-CAPTURE.md)
- Post-milestone retro: [docs/RETROSPECTIVE.md](docs/RETROSPECTIVE.md)
- Doc index: [docs/README.md](docs/README.md)

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
# Onboard the repo — extract a RepoProfile in ~12 s / ~$0.001
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
  api/                 Fastify HTTP surface (POST /v1/tests, /v1/repos, /v1/heals)
  worker/              In-process poll loop dispatching Coverage / Onboarding / Triage
packages/
  ops-types/           Shared TypeScript: TaskManifest, RepoProfile, LLM contract
  ops-prompts/         Prompt loader (YAML front-matter + Mustache render)
  eval-harness/        Golden-corpus regression runner for prompt changes
  rls-tests/           Postgres RLS isolation tests (9 tests, ~130ms)
prompts/               Versioned prompts (system + user-template per role)
  explorer/  generator/  healer/  judge/  onboarding/  eval/
sql/migrations/        Postgres schema — RLS-first, 11 migrations
scripts/               dev-up.sh, dev-migrate.sh, seed-dev-tenant.ts,
                       test-agent.ts, demo-reset.sh
tests/                 Playwright suites (the seed test that ships)
docs/                  Design docs, demo script, outreach kit
infra/future/          Terraform for the cloud v1 target — parked
```

## npm scripts

| Command | What it does |
|---------|--------------|
| `npm run dev:up` | Start Postgres, apply migrations, seed dev tenant |
| `npm run dev` | Start API (:3001) + worker in parallel with tsx watch |
| `npm run agent` | Invoke the CLI (`add`, `heal`, `init`, `repos`, `list`, `get`) |
| `npm run demo:reset` | Reset to clean recording state (see [DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md)) |
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

Copy `.env.example` → `.env` and fill in what you need. Defaults work for DB + dev tenant. **You must set at least one of `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`** to run Coverage / Onboarding / Triage.

## How manifests flow

1. CLI (`test-agent add / init / heal`) → `POST /v1/tests | /v1/repos/:id/onboard | /v1/heals` → API inserts a `manifests` row with `status = pending`
2. Worker polls Postgres (`FOR UPDATE SKIP LOCKED`) → claims a manifest → sets `assigned`
3. Role-based workflow runs: **Coverage** (Explorer → Generator → Judge), **Onboarding** (scan → LLM classify → persist profile), or **Triage** (baseline → classify → snapshot → heal → verify) — every phase appends to `manifest_events`
4. Terminal state (`succeeded` | `rejected` | `failed`) recorded on the manifest with a `result` JSON blob

Full sequence diagrams in [docs/Q1-SEQUENCE-DIAGRAMS.md](docs/Q1-SEQUENCE-DIAGRAMS.md).

## Multi-tenancy

The dev tenant is hardcoded (`DEV_ORG_ID`, `DEV_WORKSPACE_ID` in `.env`), but the RLS boundary is real. Every DB session opens with `SET LOCAL app.workspace_id = ...`. To prove isolation: `npm run test:rls`.

When we swap dev auth for WorkOS in v1, the middleware changes; the RLS policies do not.

## Where things live that surprised us

- **Prompts are code.** [prompts/](prompts/) with YAML front-matter; loaded by [packages/ops-prompts](packages/ops-prompts/); hash goes into every LLM span and every generated artifact.
- **RLS is enforced by Postgres, not by the app.** Every table has policies. See [sql/migrations/0006_rls_policies.sql](sql/migrations/0006_rls_policies.sql).
- **The Task Manifest is the API between agents.** See [packages/ops-types/src/manifest.ts](packages/ops-types/src/manifest.ts).
- **Activities are boring functions.** No Temporal in v0. When v1 arrives, wrap each function as a Temporal activity — same signature.

## What's *not* here yet

- GitHub App PR flow (v1 — cloud deploy)
- Steward Agent — flake detection, weekly reports (Milestone D)
- WorkOS SSO, Temporal Cloud, multi-tenancy (v1)
- Sandboxed browser pool (v1 — Chromium in gVisor + Egress Broker)
