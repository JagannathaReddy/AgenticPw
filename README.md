# AgenticPw

**An AI teammate for your Playwright test suite.**

Describe a user flow in plain English and get a verified Playwright test in your repo's style. Point it at a failing spec and get a fix — or a clear explanation of why it won't patch around a real bug. Run a full suite health check, heal everything it flags, and teach it from your feedback so the next run is smarter.

Works on your laptop today. Runs in CI. Includes a web console for dashboards, diffs, and one-click actions.

**Current release:** v0.13.0

---

## What you can do

| You want to… | How |
|--------------|-----|
| **Write a new test from a user story** | Describe the flow + URL → get a spec and page object, verified green before it ships |
| **Onboard a repo** | Scan your existing tests → learn folder layout, naming, locator style, and conventions |
| **Fix a broken test** | Point at a failing spec → get a dry-run diff, or a refusal (`product_bug`, `out_of_scope`, etc.) |
| **Polish a rough draft** | Turn a codegen scratch file into something that matches your team's patterns |
| **Check suite health** | Run the suite multiple times → see healthy, flaky, and always-failing tests with heal candidates |
| **Heal many tests at once** | Batch every flagged spec under one job with a hard cost cap |
| **Quarantine flaky tests** | Wrap unstable tests in `test.fixme` so they stay visible but stop blocking CI |
| **Track spend** | See every LLM call, token count, and dollar cost per manifest |

Nothing touches your files until you say so. Every run produces a **manifest** — a full audit trail of what happened, what it cost, and what changed.

---

## Requirements

- **Node.js 22+**
- **Docker** (for Postgres)
- **An LLM API key** — OpenAI or Anthropic (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)
- **A Playwright project** (or start from the included seed spec)

---

## Quick start

### 1. Install and start the platform

```bash
git clone https://github.com/JagannathaReddy/AgenticPw.git
cd AgenticPw

npm install
npm run dev:up          # Postgres + migrations + dev tenant
cp .env.example .env    # add your LLM API key
npm run dev             # API :3001, worker, web console :3000
```

Open **http://localhost:3000** for the web console, or use the CLI in another terminal.

### 2. Register your Playwright repo

```bash
npm run agent -- init /path/to/your-playwright-repo --name my-app
npm run agent -- repos    # note the shortId (e.g. TAU)
```

Onboarding takes about 10–15 seconds. The agent learns your test folder layout, naming patterns, and locator preferences.

### 3. Add your first test

```bash
npm run agent -- add \
  "Click Get Started on the Playwright home page and verify Installation heading is visible." \
  --url https://playwright.dev/ \
  --outcome "Installation heading is visible" \
  --repo <shortId>
```

Real Chromium opens, an LLM writes the code, Playwright verifies it passes. You get a dry-run diff — review it, then apply when ready:

```bash
npm run agent -- apply <manifestId>
```

Step-by-step walkthrough with sample output: [docs/guides/DEMO.md](docs/guides/DEMO.md)

---

## Web console

After `npm run dev`, open **http://localhost:3000**.

| Page | Purpose |
|------|---------|
| **Dashboard** | Suite health across repos, recent activity, cost snapshot |
| **Manifests** | Every job — status, events, diffs, apply actions |
| **Repos** | Registered Playwright projects; run steward and onboarding |
| **Steward** | Suite health reports — healthy / flaky / failing breakdown |
| **Batches** | Multi-test heal jobs from a steward report |
| **Feedback** | Rate heals so future patches match your preferences |
| **Cost** | LLM spend over time |
| **Settings** | Environment doctor checks |

The console mirrors the CLI — use whichever fits your workflow.

---

## CLI reference

All commands go through `npm run agent -- <command>`.

### Core workflows

```bash
# Register a repo
npm run agent -- init /path/to/repo --name my-app
npm run agent -- repos

# Write a test from a user story
npm run agent -- add "<goal>" --url <url> --outcome "<expected>" --repo <shortId>

# Fix one failing test
npm run agent -- heal tests/foo.spec.ts --repo <shortId>
npm run agent -- apply <manifestId>

# Suite health → batch heal → apply all
npm run agent -- steward --repo <shortId>
npm run agent -- batch --from-steward <manifestId>
npm run agent -- apply --batch <batchId>

# Quarantine flaky tests from a steward report
npm run agent -- quarantine --from-steward <manifestId>
```

### Improve, feedback, and housekeeping

```bash
# Polish a rough spec into your conventions
npm run agent -- improve tests/rough.spec.ts --repo <shortId>

# Rate a heal (apply records 👍 automatically)
npm run agent -- feedback <manifestId> --down --note "Use getByTestId, text is localized"
npm run agent -- feedback --stats

# Inspect runs and spend
npm run agent -- list
npm run agent -- get <manifestId>
npm run agent -- cost --since 7d
npm run agent -- doctor
```

### Options worth knowing

| Flag | Effect |
|------|--------|
| `--repo <shortId>` | Target a registered repo (required for most commands) |
| `--auto-apply` | Apply a verified patch immediately (trust rung 2) |
| `--include 'src/**/*.ts'` | Let heal search helper files outside the spec |
| `--format github` | Output suited for CI job summaries |
| `--max-cost N` | Hard dollar cap for a batch run |

Full usage: `npm run agent --` (no args) prints help.

---

## Trust levels

AgenticPw never silently edits your repo. Patches are verified by re-running Playwright before you see them.

| Level | Behavior |
|-------|----------|
| **L1 — Dry run** (default) | Shows diffs; you run `apply` to write files |
| **L2 — Auto-apply** | Verified heals apply themselves (`--auto-apply` or repo setting) |
| **L3 — Open PR** | CI mode commits verified heals to a branch and opens a PR for review |

Every manifest carries a **policy**: refused categories (e.g. won't weaken assertions), LLM spend cap, and trust rung. If a run hits its budget mid-flight, it stops and records what was spent.

---

## CI integration

Use the included GitHub Action to run AgenticPw on your own repo:

- **Heal on failure** — when a Playwright test fails on a PR, get a verified fix suggestion as a comment ([heal-on-failure.yml](.github/workflows/heal-on-failure.yml))
- **Weekly suite health** — steward report in the job summary, with optional batch heal ([suite-health.yml](.github/workflows/suite-health.yml))

Setup and secrets: [docs/guides/SECURITY-CI.md](docs/guides/SECURITY-CI.md)

CI mode is **dry-run by default** — suggestions only, never gates your build unless you opt in.

---

## How it works (short version)

Every job is a **manifest** stored in Postgres with a full event log:

1. You submit via CLI or web console → API creates a pending manifest
2. The worker picks it up and runs the workflow (explore → generate → verify, or classify → heal → verify, etc.)
3. Every LLM call is metered; every step emits an event you can stream live
4. The run ends as **succeeded**, **rejected** (with a reason), or **failed**

Key guarantees:

- **Prompts are versioned code** in [`prompts/`](prompts/) — not hidden strings
- **Nothing unverified ships** — generated tests must pass Playwright *and* assert every expected outcome
- **Refusals are first-class** — when a patch would hide a product bug, you get a category, not a guess

Architecture details: [docs/design/Q1-TECHNICAL-DESIGN.md](docs/design/Q1-TECHNICAL-DESIGN.md) · [sequence diagrams](docs/design/Q1-SEQUENCE-DIAGRAMS.md)

---

## Documentation

| Guide | What's inside |
|-------|---------------|
| [Full demo walkthrough](docs/guides/DEMO.md) | End-to-end coverage, onboarding, heal |
| [CI security setup](docs/guides/SECURITY-CI.md) | Secrets, permissions, trust in CI |
| [Roadmap](docs/planning/NEXT-PLAN.md) | What's planned next |
| [Docs index](docs/README.md) | Everything else |

---

## For contributors

### Repository layout

```
apps/
  api/          REST API + SSE event stream (:3001)
  worker/       Poll loop — runs explore, generate, heal, steward workflows
  web/          Next.js console (:3000)
packages/
  ops-types/    Shared TypeScript contracts
  ops-prompts/  Prompt loader (YAML front-matter)
  eval-harness/ Golden-corpus regression for prompt changes
  rls-tests/    Postgres tenant-isolation tests
prompts/        Versioned prompts per role
sql/migrations/ Postgres schema
scripts/        CLI (test-agent.ts) + db lifecycle
```

### Common dev commands

| Command | What it does |
|---------|--------------|
| `npm run dev:up` | Start Postgres, migrate, seed dev tenant |
| `npm run dev` | API + worker + web with hot reload |
| `npm run build` | Compile all workspaces |
| `npm run typecheck` | Typecheck packages and apps |
| `npm run test:rls` | Cross-tenant isolation tests |
| `npm run test:playwright` | Run the seed Playwright suite |
| `npm run eval` | Prompt eval harness |
| `npm run prompts:validate` | Validate all prompt front-matter |
| `npm run demo:reset` | Clean state for recording a demo |

Copy [`.env.example`](.env.example) → `.env`. Defaults work for DB and the dev tenant; you only need to set an LLM key.

CI runs typecheck, unit tests, prompt validation, and RLS tests on every push — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## What's not here yet

- GitHub App PR flow, SSO, hosted cloud service
- Sandboxed browser pool and multi-tenant SaaS deployment

These are scoped in the [design doc](docs/design/Q1-TECHNICAL-DESIGN.md) and parked in [`infra/future/`](infra/future/).

---

## License

Private — see repository settings.
