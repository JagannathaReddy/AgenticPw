---
name: playwright-specialist
description: Orchestrates Playwright Loop Engineering — plan, generate, run, heal test cycles in Cursor with verification gates. Use for E2E tests, Playwright agents, self-healing, playwright-cli, Planner/Generator/Healer workflows.
---

# Playwright Specialist (Loop Engineering)

## Read first

| Doc | Purpose |
|-----|---------|
| [docs/LOOP-ENGINEERING.md](../../docs/LOOP-ENGINEERING.md) | Loop rules + phase prompts |
| [docs/README.md](../../docs/README.md) | Documentation map |

## Rules

1. Never claim done without `npx playwright test` exit 0 for scoped tests.
2. Follow master loop: **Plan → Generate → Run → Heal → Verify**.
3. Use `/goal` and `/loop` templates from LOOP-ENGINEERING.md.
4. Update `.loop/run-log.json` each iteration.
5. CLI first (`npx playwright-cli` or bundled skill); MCP for deep exploration/healing.
6. Agents: `.cursor/rules/playwright-*.mdc` and `.github/agents/*.md`.

## Commands

```bash
npm test
npm run loop
npm run loop:verify
npm run loop:state
npx playwright test --list
```

## IDE routing

| IDE | Invoke |
|-----|--------|
| Cursor | This skill + `.cursor/rules/*.mdc` |
| Copilot | Agent mode + `.github/agents/playwright-test-*.agent.md` |

## Autonomous agent (optional)

Stagehand daemon — [docs/AUTONOMOUS-AGENT.md](../../docs/AUTONOMOUS-AGENT.md). Not a substitute for loop verification.

```bash
npm run agent:dev
```
