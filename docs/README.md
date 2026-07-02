# Documentation

Playwright Specialist POC — Loop Engineering for Cursor and VS Code Copilot, plus an optional Stagehand autonomous agent.

## Start here

| Doc | When to read |
|-----|----------------|
| [../README.md](../README.md) | Install and quick start |
| [LOOP-ENGINEERING.md](./LOOP-ENGINEERING.md) | **Required** — loop rules, phase prompts, templates |
| [AUTONOMOUS-AGENT.md](./AUTONOMOUS-AGENT.md) | Stagehand daemon, auto-loop, API, env, operations |
| [PLAN.md](./PLAN.md) | Platform plan and research (reference) |

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  IDE (Cursor / VS Code Copilot)                             │
│  Planner → Generator → Healer + Loop Engineering docs       │
└──────────────────────────┬──────────────────────────────────┘
                           │ specs/*.md, tests/*.spec.ts
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Playwright (@playwright/test, CLI, MCP)                    │
│  npm test · playwright.config.ts (env-driven)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
  .loop/ state                         Optional: agent-server
  run-log, last-run                    Stagehand jobs → auto-loop
```

## Two workflows

**Loop Engineering (IDE)** — human or IDE agents drive Plan → Generate → Run → Heal → Verify using specs and tests in this repo.

**Autonomous agent (daemon)** — Stagehand executes open-ended browser goals; optional auto-loop writes specs, page objects, and tests under `specs/` and `tests/`.

Both share the same verification bar: `npx playwright test` must pass before claiming done.

## Stack

| Layer | Technology |
|-------|------------|
| Test runner | `@playwright/test` |
| Browser CLI | `@playwright/cli` (`.cursor/skills/playwright-cli/`) |
| Test MCP | `npx playwright run-test-mcp-server` |
| IDE agents | `.github/agents/*.md` (Copilot); `.cursor/rules/*.mdc` (Cursor) |
| Loop orchestration | [LOOP-ENGINEERING.md](./LOOP-ENGINEERING.md) + `scripts/loop.sh` |
| Autonomous agent | `packages/agent-server` (Stagehand + Fastify) |

## IDE setup

| | Cursor | VS Code + Copilot |
|---|--------|-------------------|
| Agent definitions | `.cursor/rules/playwright-*.mdc` | `.github/agents/playwright-test-*.agent.md` |
| MCP | `.cursor/mcp.json` | `.vscode/mcp.json` |
| Orchestration | `@playwright-specialist` skill | [.github/copilot-instructions.md](../.github/copilot-instructions.md) |
| Init | Manual rules (no `--loop=cursor` in Playwright 1.58+) | `npx playwright init-agents --loop=copilot` |

**Shared artifacts:** `specs/`, `tests/`, `docs/LOOP-ENGINEERING.md`, `.loop/`

### Cursor

1. MCP: `.cursor/mcp.json`
2. Rules: `.cursor/rules/playwright-*.mdc`
3. Skill: `@playwright-specialist`

### VS Code + GitHub Copilot

Copilot Chat → **Agent mode** → `playwright-test-planner` / `-generator` / `-healer`

## Target application

There is no bundled app. Tests and agent jobs target **your** application:

- Pass an explicit URL per agent job, or set `AGENT_DEFAULT_URL`
- For Playwright tests, set `PLAYWRIGHT_BASE_URL` and optionally `PLAYWRIGHT_WEB_SERVER_COMMAND`
- `tests/seed.spec.ts` hits `https://playwright.dev/` so `npm test` works without a local server

| Variable | Purpose |
|----------|---------|
| `PLAYWRIGHT_BASE_URL` | Optional `baseURL` for relative navigations |
| `PLAYWRIGHT_WEB_SERVER_COMMAND` | Command to start your app before tests |
| `PLAYWRIGHT_WEB_SERVER_URL` | URL to wait on (defaults to `PLAYWRIGHT_BASE_URL`) |

## Agent server (optional)

| Package | Role |
|---------|------|
| `packages/agent-server/src/worker.ts` | Stagehand `agent.execute()` |
| `packages/agent-server/src/loop.ts` | Auto-bridge, generate, verify, heal |
| `packages/agent-server/src/memory.ts` | Learned flows at `AGENT_LOOP_LEVEL=4` |

Job artifacts: `.agent/jobs/` · Memory: `.agent/memory/` (both gitignored)

```bash
cp .env.example .env        # OPENAI_API_KEY; optional AGENT_DEFAULT_URL
npm run agent:dev           # UI at http://127.0.0.1:3847/
npm run agent:submit -- "Open the docs page. Expected: page title contains Playwright." "https://playwright.dev/"
```

Full API and env reference: [AUTONOMOUS-AGENT.md](./AUTONOMOUS-AGENT.md)

## Directory layout

| Path | Purpose |
|------|---------|
| `docs/` | Documentation (this file is the index) |
| `specs/` | Markdown test plans (Planner / agent bridge) |
| `tests/` | Playwright specs and `tests/pages/*.page.ts` page objects |
| `scripts/` | `loop.sh`, `agent-cli.sh`, phase prompt helpers |
| `packages/agent-server/` | Stagehand HTTP daemon |
| `.loop/` | Loop iteration state (JSON gitignored) |
| `.agent/` | Agent job and memory store (gitignored) |

## npm scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run Playwright tests |
| `npm run loop` | Show next loop phase prompt |
| `npm run loop:verify` | Run tests + record verify pass |
| `npm run loop:state` | Show loop state |
| `npm run agent:dev` | Start agent daemon (tsx) |
| `npm run agent:build` | Compile agent-server |
| `npm run agent:submit` | Submit a job via CLI |

## Related repo files

| Path | Role |
|------|------|
| `.github/copilot-instructions.md` | GitHub Copilot repo context |
| `.cursor/skills/playwright-specialist/SKILL.md` | Cursor `@playwright-specialist` skill |
| `.cursor/rules/playwright-*.mdc` | Cursor Planner / Generator / Healer rules |
| `.github/agents/playwright-test-*.agent.md` | Copilot agent definitions |
| `.env.example` | Agent daemon and Playwright env reference |
