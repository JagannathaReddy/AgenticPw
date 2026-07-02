# Autonomous Agent & Auto-Loop

Stagehand HTTP daemon for open-ended browser tasks, with an optional **auto-loop** that bridges successful runs into `specs/`, `tests/`, verify, heal, and memory reuse.

Separate from the IDE Loop Engineering flow ([LOOP-ENGINEERING.md](./LOOP-ENGINEERING.md)), but uses the same verification bar: generated tests must pass `npx playwright test`.

**See also:** [README.md](./README.md) · [`.env.example`](../.env.example)

---

## Quick start

```bash
cp .env.example .env
# Set OPENAI_API_KEY (or ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY)

npm run agent:dev
# Open http://127.0.0.1:3847/

npm run agent:submit -- "Open the docs page. Expected: page title contains Playwright." "https://playwright.dev/"
bash scripts/agent-cli.sh status <jobId>
bash scripts/agent-cli.sh events <jobId>
```

- Health: `curl http://127.0.0.1:3847/v1/health`
- Web UI: submit jobs, stream events, cancel, bridge to tests

---

## End-to-end flow

### Job lifecycle

```
queued → running → succeeded | failed | cancelled | timeout
```

### Auto-loop (when `AGENT_LOOP_LEVEL ≥ 1`)

```
Stagehand executes goal
  → bridge spec (specs/autonomous-*.md)
  → generate tests + page object (level ≥ 2)
  → playwright test + heal ≤3 attempts (level ≥ 3)
  → record memory for reuse (level ≥ 4, after tests pass)
```

At level 0, bridge/generate/verify are manual (UI or CLI). The worker runs the auto-loop hook automatically on success when the configured level requires it.

### Relation to Loop Engineering

| IDE loop | Autonomous auto-loop |
|----------|----------------------|
| Planner writes specs | Bridge writes `specs/autonomous-*.md` |
| Generator in IDE | `generator.ts` templates + POM |
| Healer in IDE | `healer.ts` rule + LLM heal |
| `npm run loop` | Worker hook + `POST /v1/jobs/:id/run-loop` |

Master loop **Plan → Generate → Run → Heal → Verify** is unchanged; the agent automates it for exploratory, agent-origin work.

---

## Autonomy levels

Set `AGENT_LOOP_LEVEL` in `.env` (or use `AGENT_AUTO_BRIDGE=true` for level-1 bridge only).

| Level | Env | On job success |
|-------|-----|----------------|
| 0 | `AGENT_LOOP_LEVEL=0` | Manual bridge via UI or CLI |
| 1 | `AGENT_LOOP_LEVEL=1` | Auto-write `specs/autonomous-*.md` |
| 2 | `AGENT_LOOP_LEVEL=2` | + `tests/autonomous-*.spec.ts` + page object |
| 3 | `AGENT_LOOP_LEVEL=3` | + `playwright test` with auto-heal (≤3) |
| 4 | `AGENT_LOOP_LEVEL=4` | + persist/reuse locators in `.agent/memory/` |

**Recommended:** level **2** for hands-off test files; level **4** when iterating on the same hosts.

Results at level 3+ append to `.loop/run-log.json` with `source: agent-server`.

---

## HTTP API (v1)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/health` | Liveness, queue depth, config summary |
| `GET` | `/v1/jobs` | List recent jobs (max 50) |
| `POST` | `/v1/jobs` | Submit `{ "goal", "url"?, "maxSteps"? }` |
| `GET` | `/v1/jobs/:id` | Job status and result |
| `GET` | `/v1/jobs/:id/events` | SSE stream |
| `POST` | `/v1/jobs/:id/cancel` | Cancel queued or running job |
| `GET` | `/v1/memory/lookup?goal=&url=` | Check learned flow (level 4) |
| `GET` | `/v1/probe?url=` | Pre-flight URL reachability |
| `POST` | `/v1/jobs/:id/bridge-to-tests` | Write spec (+ tests when level ≥ 2) |
| `POST` | `/v1/jobs/:id/generate-tests` | Write/regenerate spec + test files |
| `POST` | `/v1/jobs/:id/verify-tests` | Run test + heal loop |
| `POST` | `/v1/jobs/:id/run-loop` | Full auto-loop for a succeeded job |

### Submit example

```bash
curl -sS -X POST http://127.0.0.1:3847/v1/jobs \
  -H 'Content-Type: application/json' \
  -d '{"goal":"Open the docs page. Expected: page title contains Playwright.","url":"https://playwright.dev/","maxSteps":15}'
```

### Manual bridge

```bash
bash scripts/agent-cli.sh bridge <jobId>
```

---

## Auto-loop internals

### Generator templates

| Template | When used | Output |
|----------|-----------|--------|
| `login` | Simple credential goal, ≤6 steps | Login page object + auth assertion |
| `generic` | Multi-step or post-login work | Goto + expected-outcome assertions when the agent verified them |

Locators prefer memory at level 4; otherwise inferred from goal text and agent action trace. No app-specific hardcoding.

### Memory (level 4)

```
.agent/memory/
  hosts/<host>.json
  flows/<goal-hash>.json
  locators/<host>__<kind>.json
```

**Record** after tests pass: host, template, locators, actions, test path.

**Reuse:** injected into Stagehand instructions, generator, and healer before the next matching job.

### Safety

- Auto-loop runs only when agent message, action trace, and expected outcomes all look successful
- Failed agent runs mark the job **`failed`** (queue), not `succeeded` with a silent auto-loop skip
- Heal only files tagged `// generated-from: agent <jobId>`
- Job can `succeed` while `loopStatus: tests_failed`
- Verify rejects tests that pass but omit goal outcome assertions
- Heal captures an accessibility tree (`page.locator('body').ariaSnapshot()`) saved under `.agent/heal-snapshots/` and passes it to the LLM healer
- Never auto-edit hand-written tests

### Source layout

| Component | Path | Role |
|-----------|------|------|
| Entry | `packages/agent-server/src/index.ts` | Config, graceful shutdown |
| HTTP API | `packages/agent-server/src/server.ts` | Fastify routes |
| Queue | `packages/agent-server/src/queue.ts` | Single concurrent browser job |
| Store | `packages/agent-server/src/store.ts` | JSON under `.agent/jobs/` |
| Worker | `packages/agent-server/src/worker.ts` | Stagehand + auto-loop hook |
| Loop | `packages/agent-server/src/loop.ts` | Bridge → generate → verify pipeline |
| Guardrails | `packages/agent-server/src/guardrails.ts` | maxSteps, timeout, host allowlist, agent failure phrases |
| Quality gates | `packages/agent-server/src/agent-quality.ts` | Block auto-loop when agent message/actions/outcomes fail; verify tests assert goal outcomes |
| Generator | `packages/agent-server/src/generator.ts` | Templates + POM |
| Healer | `packages/agent-server/src/healer.ts` | Rule + LLM heal with ARIA tree on failure |
| Failure context | `packages/agent-server/src/failure-context.ts` | Captures `ariaSnapshot` for heal prompts |
| Memory | `packages/agent-server/src/memory.ts` | Flows and locators |
| Bridge | `packages/agent-server/src/bridge.ts` | Spec markdown |
| Actions | `packages/agent-server/src/actions.ts` | Normalized action trace |
| UI | `packages/agent-server/public/` | Job console |

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | LLM for Stagehand (or Anthropic/Google vars) |
| `AGENT_PORT` | `3847` | HTTP listen port |
| `AGENT_HOST` | `127.0.0.1` | Bind address |
| `AGENT_DEFAULT_URL` | *(empty)* | Fallback when job omits URL |
| `AGENT_MAX_STEPS` | `30` | Default step limit |
| `AGENT_MAX_STEPS_CAP` | `100` | Hard cap per request |
| `AGENT_JOB_TIMEOUT_MS` | `300000` | Wall-clock timeout |
| `AGENT_ALLOWED_HOSTS` | `127.0.0.1,localhost` | LOCAL mode host allowlist (hostnames; full URLs are normalized to hostname) |
| `AGENT_MODEL` | `openai/gpt-4o-mini` | Stagehand model (`provider/model`) |
| `STAGEHAND_ENV` | `LOCAL` | `LOCAL` or `BROWSERBASE` |
| `BROWSERBASE_API_KEY` | — | Required when `STAGEHAND_ENV=BROWSERBASE` |
| `AGENT_AUTO_BRIDGE` | `false` | Also enabled when `AGENT_LOOP_LEVEL ≥ 1` |
| `AGENT_LOOP_LEVEL` | `0` | See autonomy levels |
| `AGENT_MEMORY_DIR` | `.agent/memory` | Learning store (level 4) |
| `AGENT_MAX_HEAL_ATTEMPTS` | `3` | Healer retries (level 3+) |
| `AGENT_TEST_TIMEOUT_MS` | `180000` | Subprocess timeout for `playwright test` |
| `AGENT_TEST_HEADED` | `false` | Run verify/heal with `--headed` |
| `AGENT_HEAL_A11Y` | `true` | Capture ARIA tree at target URL before each heal attempt |
| `AGENT_REQUIRE_API_KEY` | `true` | Set `false` for health-only CI |
| `AGENT_RATE_LIMIT_PER_MIN` | `30` | Per-IP token bucket |
| `AGENT_SMOKE_GOAL` | — | Optional CI smoke goal |
| `AGENT_SMOKE_URL` | — | Optional CI smoke URL |

---

## Goal writing

The worker builds a structured prompt from your goal text:

1. One action per sentence or clause.
2. Put credentials in the goal: `username as X` / `password is Y`.
3. End with **Expected …** so success is unambiguous.
4. Do not paste job JSON; use plain language in the Goal field.
5. Set Target URL separately unless the goal must include it.

---

## Guardrails

- **maxSteps** capped at `AGENT_MAX_STEPS_CAP`
- **Timeout** → job status `timeout`
- **Host allowlist** in LOCAL mode
- **Browser cleanup** in `finally`
- **Cancel** closes browser mid-run
- **Rate limit** 429 on API (health exempt)
- **Agent outcome** rejected when message indicates partial failure

---

## Operations

**Shutdown:** `SIGINT` / `SIGTERM` drain queue (up to 60s).

**Artifacts:** `.agent/jobs/<uuid>.json` (gitignored).

**Cloud browsers:** `STAGEHAND_ENV=BROWSERBASE` + `BROWSERBASE_API_KEY`.

**CI smoke:**

```bash
bash scripts/agent-smoke.sh
```

Health always; live job when `OPENAI_API_KEY`, `AGENT_SMOKE_GOAL`, and `AGENT_SMOKE_URL` are set.

## npm scripts

| Script | Command |
|--------|---------|
| `npm run agent:dev` | Start daemon (tsx) |
| `npm run agent:build` | Compile TypeScript |
| `npm run agent:start` | Run compiled daemon |
| `npm run agent:submit` | CLI job submit |

## Security

- Bind to `127.0.0.1` in development; do not expose without auth in production
- Keep credentials in goal text or env — not in committed config
- Host allowlist enforced in LOCAL mode

---

## Roadmap (open decisions)

1. **LLM generator fallback** — templates today; LLM path for arbitrary multi-step flows
2. **Stable test names** — job-id vs goal-hash (better for learning)
3. **CI targets** — public fixtures vs `PLAYWRIGHT_WEB_SERVER_COMMAND`
4. **Package split** — extract `agent-loop` only if generator/heal grows substantially
