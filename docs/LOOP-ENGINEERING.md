# Loop Engineering

Canonical guide for the IDE test loop: rules, gates, phase prompts, and templates. Read this before any plan, generate, or heal work.

**See also:** [README.md](./README.md) (doc map) · [AUTONOMOUS-AGENT.md](./AUTONOMOUS-AGENT.md) (Stagehand daemon + auto-loop)

## Master loop

```
Plan (Planner) → Generate (Generator) → Run (playwright test) → Heal (Healer) → Verify
```

| Phase | Gate before next phase |
|-------|------------------------|
| Plan | `specs/<feature>.md` exists with numbered scenarios; references `tests/seed.spec.ts` |
| Generate | `npx playwright test --list` includes new tests |
| Run | Result saved to `.loop/last-run.json` |
| Heal | Pass, `test.skip` with reason, or 3 attempts exhausted |
| Verify | `npx playwright test` exit 0; CI green for merge |

## Stop rules

- **Done:** scoped tests pass; no tests in `healing` state in run-log
- **Stop (failure):** Healer skips test; master iteration count > 2; heal attempts > 3 per test

## Sub-loops

| Agent | Pattern | Termination |
|-------|---------|-------------|
| Planner | navigate → snapshot → document → repeat | Plan markdown complete |
| Generator | write step → verify locator in browser → repeat | All spec steps have working locators |
| Healer | run → trace/snapshot → patch → rerun (max 3) | Pass, skip, or attempts exhausted |

Daemon auto-heal (level 3+) also captures a Playwright `ariaSnapshot` at the job target URL before each heal attempt — see [AUTONOMOUS-AGENT.md](./AUTONOMOUS-AGENT.md).

---

## Phase workflows

### How to use

1. Run `npm run loop` to see the current phase and verification gate.
2. Invoke the agent for that phase (table below).
3. Do not advance until the gate passes.

Replace `<feature>` with your scenario name (e.g. `login`, `checkout`, `admin-search`).

| Phase | Cursor | Copilot |
|-------|--------|---------|
| Plan | `@playwright-specialist` | `playwright-test-planner` |
| Generate | `@playwright-specialist` or generator rule | `playwright-test-generator` |
| Heal | `@playwright-specialist` or healer rule | `playwright-test-healer` |

### Planner

**Gate:** `specs/<feature>.md` exists and references `tests/seed.spec.ts`.

```
Plan <feature> for the target application.
Use tests/seed.spec.ts for setup context.
Explore the live app (MCP or playwright-cli).
Save plan to specs/<feature>.md with numbered scenarios, steps, and expected results.
Do not generate test code yet.
```

Helper: `bash scripts/plan.sh <feature>`

### Generator

**Gate:** `npx playwright test --list` includes the new tests.

```
Generate Playwright tests from specs/<feature>.md section <N>.
Match imports and style of tests/seed.spec.ts.
Verify each selector live before writing.
Output to tests/<feature>.spec.ts.
Run npx playwright test --list to confirm tests are discovered.
```

Helper: `bash scripts/generate.sh <feature>`

### Healer

**Gate:** test passes, or `test.skip` with a documented reason after ≤3 attempts.

```
Heal failing test tests/<feature>.spec.ts.
Run with trace. Read .loop/last-run.json if present.
Apply the smallest locator or wait fix. Rerun until pass or 3 attempts.
If the product is broken, use test.skip with a comment.
Log each attempt in .loop/run-log.json.
```

Helper: `bash scripts/heal.sh <feature>`

### Verify

**Gate:** `npx playwright test` exit 0 for scoped tests.

```bash
npm run loop:verify
# or
npx playwright test tests/<feature>.spec.ts
```

---

## Prompt templates

### `/goal`

Defines done conditions upfront:

```
/goal <feature description>
Done only when:
1. specs/<name>.md exists with scenarios
2. tests/<name>.spec.ts passes: npx playwright test tests/<name>.spec.ts
3. tests/seed.spec.ts still passes
Stop when all pass. Max 2 master loop iterations. Log to .loop/run-log.json.
```

Optional active goal file: `.loop/goals.md`

### `/loop`

Verification-driven iteration (Healer or post-generate):

```
/loop Run npx playwright test <path>.
If failing: invoke Healer, smallest fix, rerun.
Stop when exit 0 or 3 heal attempts exhausted.
Update .loop/run-log.json each iteration.
```

---

## Loop state (`.loop/`)

| File | Purpose |
|------|---------|
| `run-log.json` | phase, iteration, lastAgent, testsHealed, healAttempts, stoppedReason |
| `last-run.json` | exitCode, failedTests[], timestamp |
| `goals.md` | active `/goal` block (optional) |

Example `run-log.json`:

```json
{
  "phase": "heal",
  "iteration": 1,
  "masterIteration": 1,
  "lastAgent": "healer",
  "testsHealed": [],
  "healAttempts": {},
  "stoppedReason": null
}
```

Initialize or inspect state:

```bash
npm run loop:state
bash scripts/loop-state.sh init
```

## CLI vs MCP

| Tool | Use for |
|------|---------|
| **CLI** (`npx playwright-cli`, `.cursor/skills/playwright-cli/`) | Default: run, snapshot, mock — token efficient |
| **MCP** (`.cursor/mcp.json`, `.vscode/mcp.json`) | Planner exploration, Healer debugging |

## Feedback checklist

Every loop must define:

1. **Goal rules** — what done means
2. **Verification** — `npx playwright test`, trace on failure
3. **Feedback** — `.loop/last-run.json`, trace zip, CLI snapshot
4. **Retry** — Healer max 3; master max 2
5. **Stop** — skip with comment, human review, never infinite loop

## Quality bar

- Prefer `getByRole`, `getByTestId`, `getByLabel`
- Avoid arbitrary `waitForTimeout`
- Match patterns in `tests/seed.spec.ts`
- One logical assertion focus per step where practical
- Update `.loop/run-log.json` each iteration
