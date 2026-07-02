# Playwright Specialist POC — Copilot instructions

This repo uses **Loop Engineering** for Playwright test automation.

## Read first

| Doc | Purpose |
|-----|---------|
| [docs/LOOP-ENGINEERING.md](docs/LOOP-ENGINEERING.md) | Loop rules, phase prompts, templates |
| [docs/README.md](docs/README.md) | Full documentation map |
| [docs/PLAN.md](docs/PLAN.md) | Platform plan and research (reference) |

## Workflow

1. Copilot Chat → **Agent mode**
2. Select: `playwright-test-planner`, `playwright-test-generator`, or `playwright-test-healer`
3. Follow loop order: **Plan → Generate → Run → Heal → Verify**
4. Always run `npx playwright test` before claiming done

## Conventions

- Plans: `specs/*.md`
- Tests: `tests/*.spec.ts` (seed: `tests/seed.spec.ts`)
- Page objects: `tests/pages/*.page.ts` when using POM
- Playwright: optional `PLAYWRIGHT_BASE_URL` / `PLAYWRIGHT_WEB_SERVER_COMMAND` in `playwright.config.ts`
- Loop state: `.loop/run-log.json` (gitignored)
- Prefer `getByRole`, `getByTestId`, `getByLabel`; avoid `waitForTimeout`
- Healer: max 3 fix attempts; master loop max 2 iterations
- No bundled demo app — target the user's application

## Scripts

```bash
npm test
npm run loop
npm run loop:verify
npm run loop:state
```

## Autonomous agent (optional)

Separate Stagehand daemon — see [docs/AUTONOMOUS-AGENT.md](docs/AUTONOMOUS-AGENT.md).

```bash
npm run agent:dev
```
