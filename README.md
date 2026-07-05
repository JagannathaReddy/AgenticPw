# test-agent — an AI teammate for your Playwright suite

Describe a test in English → get code in your repo's style. Point it at a
failing test → get a verified patch, or a categorized refusal. Ask about your
suite → get a health report that separates flaky from broken — then heal
everything it flagged in one command, and rate the patches so the next heal
is smarter. It runs on a laptop and, since v0.7.0, in your CI.

**Release:** `v0.8.0-steward-ci` · previous tags: `v0.7.0-ci` · `v0.6.0-feedback` · `v0.5.0-batch` · `v0.4.0-steward` · `v0.3.0-dx` · `v0.2.0-triage` · `v0.1.0-local-q1`

## What it does

| Flow | Command | What you get |
|------|---------|--------------|
| **Coverage** | `agent add "<goal>" --url …` | A real Playwright spec + page object in your repo's conventions, verified green before it ships |
| **Onboarding** | `agent init . --name my-repo` | A `RepoProfile` of your conventions (locator style, POM layout, naming) that every other flow consumes |
| **Triage** | `agent heal tests/foo.spec.ts` | A dry-run diff that fixes `locator_drift`/`timing` failures — or a refusal (`product_bug`, `out_of_scope`, …) when a patch would hide a real bug |
| **Improve** | `agent improve tests/rough.spec.ts` | A rough `codegen` draft polished into your conventions |
| **Steward** | `agent steward` | Suite health from K repeated runs: healthy / flaky / always-failing, with heal candidates and trend deltas |
| **Batch** | `agent batch --from-steward <id>` | Every flagged spec healed under one parent manifest with a hard cost cap |
| **Feedback** | `agent feedback <id> --down --note "…"` | Human verdicts stored per repo and injected into the next heal's prompt; `apply` records a 👍 automatically |

Everything is dry-run by default; `agent apply` is the only thing that touches
your files. Every LLM call is metered (`agent cost`), every step is an event
you can watch live over SSE.

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

Then, in another terminal:

```bash
npm run agent -- init . --name my-repo     # teach it your conventions (~12s, ~$0.001)
npm run agent -- repos                     # grab the shortId

npm run agent -- add \
  "Click Get Started on the Playwright home page and verify Installation heading is visible." \
  --url https://playwright.dev/ \
  --outcome "Installation heading is visible" \
  --repo <shortId>
```

Real Chromium opens, a real LLM writes the code, real Playwright verifies it —
`succeeded` in ~20 seconds. The full 7-part walkthrough with observed output is
[docs/guides/DEMO.md](docs/guides/DEMO.md).

## Everyday usage

```bash
# A test broke — get a verified fix as a dry-run diff
npm run agent -- heal tests/foo.spec.ts --repo <shortId>
npm run agent -- heal tests/foo.spec.ts --include 'src/helpers/**/*.ts'  # failure lives in a helper?
npm run agent -- apply <manifestId>                                       # happy with the diff

# Suite hygiene: report → batch heal → apply all → prove it
npm run agent -- steward --repo <shortId>
npm run agent -- batch --from-steward <manifestId>
npm run agent -- apply --batch <batchId>

# Teach it: apply already records a 👍; corrections carry the signal
npm run agent -- feedback <manifestId> --down --note "text is localized — use getByTestId"
npm run agent -- feedback --stats          # accept-rates per category / prompt version

# Housekeeping
npm run agent -- doctor                    # one-shot environment health check
npm run agent -- cost --since 7d           # LLM spend ledger
npm run agent -- list                      # recent manifests
```

## CI mode

[`.github/actions/heal`](.github/actions/heal/action.yml) boots the whole
stack on a GitHub runner and, depending on `mode`, batch-heals a spec glob
(verified diffs as a PR comment) or runs a steward suite-health report into
the job summary — dry-run, suggestions only, budget-capped, never gates CI.
This repo dogfoods both: [heal-on-failure.yml](.github/workflows/heal-on-failure.yml)
on same-repo PRs touching `tests/**`, and [suite-health.yml](.github/workflows/suite-health.yml)
weekly (flaky-vs-broken report, heal candidates chained to
`agent batch --from-steward`). Wire your key per
[docs/guides/SECURITY-CI.md](docs/guides/SECURITY-CI.md).

## How it works

Every job is a **Task Manifest** — an event-sourced row in Postgres:

1. The CLI posts to the API (`POST /v1/tests|heals|improves|stewards|batches|feedback`); the API inserts a `manifests` row (`pending`)
2. The worker claims it (`FOR UPDATE SKIP LOCKED`) and runs the role's workflow — every phase appends to `manifest_events`, every LLM call is metered into `llm_calls`
3. Terminal state (`succeeded` / `rejected` / `failed`) lands with a `result` blob; the CLI streams progress over SSE

Workflows: **Coverage** (Explorer → Generator → Judge), **Onboarding** (scan →
classify → profile), **Triage** (baseline → classify → stack-walk helpers →
feedback context → heal → verify), **Improve**, **Steward** (suite ×K → flake
analysis → report), **Batch** (orchestrator running child triages inline with
a cost gate). Sequence diagrams: [docs/design/Q1-SEQUENCE-DIAGRAMS.md](docs/design/Q1-SEQUENCE-DIAGRAMS.md).

Three design choices worth knowing:

- **Prompts are code.** Versioned in [prompts/](prompts/) with YAML
  front-matter; the rendered hash lands in every LLM span. Changes are scored
  by the [eval harness](packages/eval-harness/) against a golden corpus.
- **Tenant isolation is enforced by Postgres, not the app.** Every table has
  RLS policies ([sql/migrations/](sql/migrations/)); `npm run test:rls` proves it.
- **Nothing unverified ships.** Generated tests must pass Playwright *and*
  assert every expected outcome; heals must make the failing test pass; when
  they can't, you get a category, not a guess.

## Repository layout

```
apps/
  api/                 Fastify HTTP surface + SSE event stream
  worker/              Poll loop dispatching the role workflows
packages/
  ops-types/           Shared TypeScript: TaskManifest, RepoProfile, LLM contract
  ops-prompts/         Prompt loader (YAML front-matter, fails on unbound vars)
  eval-harness/        Golden-corpus regression runner for prompt changes
  rls-tests/           Postgres tenant-isolation tests
prompts/               Versioned prompts per role + eval corpus
sql/migrations/        Postgres schema — RLS-first, timestamp-named migrations
scripts/               CLI (test-agent.ts) + db-* lifecycle + dev-up/demo-reset
tests/                 Playwright suites (seed spec; generated tests land here too)
docs/                  guides/ · planning/ · milestones/ · design/ · outreach/
.github/actions/heal/  Composite action for CI mode
infra/future/          Terraform for the cloud v1 target — parked
```

## Development

| Command | What it does |
|---------|--------------|
| `npm run dev:up` | Start Postgres, apply migrations, seed dev tenant |
| `npm run dev` | API (:3001) + worker with tsx watch |
| `npm run agent` | The CLI (`add`, `heal`, `improve`, `steward`, `batch`, `apply`, `feedback`, `init`, `repos`, `list`, `get`, `doctor`, `cost`) |
| `npm run typecheck` / `npm run build` | Typecheck / compile every workspace |
| `npm run test:rls` | Cross-tenant isolation tests |
| `npm run test:playwright` | Run the Playwright suite |
| `npm run eval` | Prompt eval harness vs `prompts/eval/corpus/` |
| `npm run prompts:validate` | Parse every prompt front-matter |
| `npm run db:migrate` / `db:seed` / `db:reset` | Migration lifecycle (reset ⚠ destroys the volume) |
| `npm run demo:reset` | Clean state for recording |

Worker unit tests run per-file: `node --test apps/worker/dist/activities/*.test.js`
(after `npm run build`). CI runs typecheck, unit tests, prompt validation, and
the RLS suite on every push — see [ci.yml](.github/workflows/ci.yml).

**Environment:** copy `.env.example` → `.env`; defaults work for DB + dev
tenant, you only must set one LLM key. The dev tenant is hardcoded but the RLS
boundary is real — swapping in real auth (v1) changes middleware, not policies.

## Documentation

The [docs index](docs/README.md) maps everything. Shortcuts:
[full demo](docs/guides/DEMO.md) ·
[CI security](docs/guides/SECURITY-CI.md) ·
[roadmap](docs/planning/NEXT-PLAN.md) ·
[milestone snapshots](docs/milestones/) ·
[original design](docs/design/Q1-TECHNICAL-DESIGN.md) ·
[retrospective](docs/milestones/RETROSPECTIVE.md)

## What's *not* here yet

- GitHub App PR flow, WorkOS SSO, Temporal, sandboxed browser pool — the
  cloud v1 target, scoped in [the design doc](docs/design/Q1-TECHNICAL-DESIGN.md)
  and parked in [infra/future/](infra/future/)
- pgvector semantic retrieval (installed, unused until generation quality needs it)
