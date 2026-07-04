# Demo: describe a test in English, get real Playwright code

**v0.1.0-local-q1** — the full local Q1 milestone. Describe a flow in English against your repo, an autonomous agent tries it, an LLM writes the test in your repo's conventions, and Playwright runs it. If any step goes wrong the manifest terminates as `rejected` — nothing bogus ever ships.

Everything below runs on a laptop. Real Chromium. Real LLM API. Real Postgres with row-level tenant isolation. No cloud.

**Four demos, in order:**
1. [Basic coverage](#1-basic-coverage-add-a-test) — describe a test, get code
2. [Repo onboarding](#2-onboarding-teach-the-agent-your-conventions) — extract a `RepoProfile` for your codebase
3. [Profile-driven coverage](#3-profile-driven-coverage-the-payoff) — same test description, now in your team's style
4. [Heal a failing test](#4-heal-a-failing-test-triage) — Triage classifies the failure + fixes it, or refuses safely

---

---

## 5-minute quick start

```bash
# One-time
docker compose up -d
bash scripts/dev-migrate.sh
npx tsx scripts/seed-dev-tenant.ts
cp .env.example .env    # then paste an OPENAI_API_KEY or ANTHROPIC_API_KEY

# Run (in one terminal)
npm run dev             # API on :3000, worker in the same process group
```

---

## 1. Basic coverage (add a test)

In a second terminal:

```bash
npm run agent -- add \
  "Click Get Started on the Playwright home page and verify the docs page loads with an Installation heading." \
  --url https://playwright.dev/ \
  --outcome "Installation heading is visible" \
  --max-steps 4
```

## What you'll see

```
Submitting manifest…
  goal:  Click Get Started on the Playwright home page and verify the docs page loads with an Installation heading.
  url:   https://playwright.dev/
  expected outcomes:
    1. Installation heading is visible

  manifestId:    7287539e-4c90-454c-8e72-beaec25fe6d6
  correlationId: 5bd38b6a-dfc7-472c-a39d-433aafb8d193

  [  0.0s] created
  [  1.5s] progress · started
  [ 15.1s] progress · exploration_done — 4 actions · verified=true
  [ 19.6s] progress · generation_done — $0.0014 · 8292+226 tok · 3912ms
  [ 21.1s] progress · judgment_done — 1926ms · passed=true · exit=0
  [ 21.1s] succeeded

✓ Coverage complete
  spec:  tests/autonomous/7287539e/get-started-navigation.spec.ts
  page:  tests/autonomous/7287539e/pages/playwrightHome.page.ts

Run it:  npx playwright test tests/autonomous/7287539e/get-started-navigation.spec.ts
```

**21 seconds** from natural language to a passing Playwright test.

## The actual generated code

```ts
// tests/autonomous/7287539e/get-started-navigation.spec.ts
import { test, expect } from '@playwright/test';
import { PlaywrightHome } from './pages/playwrightHome.page';

test('Click Get Started and verify Installation heading', async ({ page }) => {
  const playwrightHome = new PlaywrightHome(page);
  await playwrightHome.goto();
  await playwrightHome.clickGetStarted();
  await playwrightHome.verifyInstallationHeadingVisible();
});
```

```ts
// tests/autonomous/7287539e/pages/playwrightHome.page.ts
import { Page, expect } from '@playwright/test';

export class PlaywrightHome {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('https://playwright.dev/');
  }

  async clickGetStarted() {
    await this.page.getByRole('link', { name: 'Getting Started' }).click();
  }

  async verifyInstallationHeadingVisible() {
    await expect(this.page.getByRole('heading', { name: 'Installation' })).toBeVisible();
  }
}
```

No CSS selectors. No `waitForTimeout`. Real Playwright accessible locators. This is code a reviewer would merge.

## What the pipeline just did

1. **Explorer** — booted Chromium, drove `https://playwright.dev/` for 4 steps using GPT-4o-mini, captured the accessibility tree of the destination page, confirmed each expected outcome was visible.
2. **Generator** — read your repo's `tests/seed.spec.ts` as a few-shot style reference, sent the goal + observed actions + a11y tree to GPT-4o-mini, parsed the response into two files, wrote them to `tests/autonomous/7287539e/`.
3. **Judge** — copied the files into the repo (so Playwright's `testDir` finds them), ran `npx playwright test`, verified exit code 0 AND AST-checked that each expected outcome is asserted in the source.

Every step is committed to Postgres as its own event so you can trace exactly what happened. Every LLM call is metered in the `llm_calls` table with prompt hash + cost.

## Trying failure paths

The value of Judge is that it refuses to ship broken tests.

**Semantically hard goal** — verifying a `title` attribute (which isn't visible content) trips the a11y verifier:

```bash
npm run agent -- add \
  "Confirm the title contains the word Playwright." \
  --url https://playwright.dev/ \
  --outcome "title contains Playwright"

# → rejected: category=outcomes_not_verified
#   reason: unverified outcomes: "title contains Playwright"
```

**Complex dynamic UI** — the Algolia search dialog is dynamically loaded and often can't be inspected in the a11y snapshot:

```bash
npm run agent -- add \
  "Click the search button, type Locator, verify results appear." \
  --url https://playwright.dev/ \
  --outcome "search results are visible"

# → rejected: category=outcomes_not_verified
```

**Broken generated code** — if the LLM produces a page object using `expect` without importing it, Judge runs Playwright and catches the `ReferenceError`:

```
✗ rejected
  category: test_failed
  reason: Playwright exit code 1. Tail: ...ReferenceError: expect is not defined...
```

Every rejection carries a category the eventual **Triage Agent** (Milestone B) can classify into fix-vs-refuse.

---

## 2. Onboarding (teach the agent your conventions)

The Basic Coverage demo above generated a test using a heuristic style — sensible Playwright defaults. To get the agent to write tests in **your** repo's actual style, teach it about your conventions first:

```bash
npm run agent -- init . --name test-agent-poc
```

```
Registering repo…
  name: test-agent-poc
  path: /Users/jagannatha/poc

  repoId: d6556bd8-917e-4ac8-a3d5-df112eb5fd96
  status: onboarding

Kicking off onboarding…
  manifestId: 9f03af49-6042-4ba1-8c4a-fcc91c3b7f2a

  [  0.0s] created
  [  1.5s] progress · started
  [ 12.1s] progress · profile_persisted
  [ 12.1s] succeeded

✓ Onboarding complete
  profileId:   21355d8e-6bc9-44f5-827b-1438979e06b7
  confidence:  0.9
  files:       14
```

12 seconds, $0.0008, 4404 input tokens. The agent read up to 20 spec files, extracted a structured YAML profile, and stored it in the `repo_profiles` table.

Inspect what was learned:

```bash
npm run agent -- repos
# → d6556bd8  review       test-agent-poc  · has profile
#             /Users/jagannatha/poc

# Or via API:
curl -s http://127.0.0.1:3001/v1/repos/d6556bd8-917e-4ac8-a3d5-df112eb5fd96 | jq '.profile'
```

Excerpt:

```yaml
structure:
  page_object_style: pom_class
  page_object_dir: tests/pages
  filename_convention: kebab-case      # ← the model detected our convention
  spec_suffix: .spec.ts
locators:
  primary_pattern: getByRole           # ← detected from real usage
  test_id_attribute: null              # ← we don't use data-testid
imports:
  test_import_source: "@playwright/test"
conventions_confidence: 0.9
```

---

## 3. Profile-driven coverage (the payoff)

Now submit the same test description with `--repo` — the generator uses your extracted profile as authoritative style guidance:

```bash
npm run agent -- add \
  "Open the Playwright home page and confirm the title contains Playwright." \
  --url https://playwright.dev/ \
  --outcome "title contains Playwright" \
  --max-steps 2 \
  --repo d6556bd8
```

```
Repo: test-agent-poc (d6556bd8) — profile ✓

Submitting manifest…
  ...
  [ 15.1s] progress · generation_done — $0.0015 · 9049+172 tok · 3645ms
  [ 15.1s] succeeded

✓ Coverage complete
  spec:  tests/autonomous/7ab93ee3/playwright-home.spec.ts     # ← kebab-case, as the profile dictates
```

Compare to the same command without `--repo` (heuristic mode):

```
✓ Coverage complete
  spec: tests/autonomous/10ba9072/playwrightHome.spec.ts       # ← camelCase, LLM default
```

**Same goal, same LLM, same seed.** The only reason the filename convention flips from `camelCase` to `kebab-case` is that the extracted profile is now injected into the prompt as ground truth.

The `usedProfile` flag is recorded on the `generation_done` manifest event so you can filter later:

```bash
docker exec test-agent-postgres psql -U platform -d platform -c \
  "SELECT payload->>'usedProfile', payload->>'testPath' FROM manifest_events WHERE payload->>'stage'='generation_done' LIMIT 5;"
```

### A/B receipts

| | Without `--repo` | With `--repo` |
|---|---|---|
| Filename | `playwrightHome.spec.ts` | **`playwright-home.spec.ts`** |
| Input tokens | 8,575 | 9,049 (+474 = injected profile YAML) |
| `usedProfile` in event | `false` | **`true`** |
| Cost | $0.0014 | $0.0015 |

---

---

## 4. Heal a failing test (Triage)

Once a test exists (either hand-written or generated by Coverage), it will eventually break — a button renames, an element moves, an async race shifts. Triage classifies the failure and heals safe categories without ever mutating the original file.

### Setup — break a working test

Take the test we generated in Section 1 and break it by pointing a locator at something that doesn't exist:

```ts
// tests/autonomous/3b231976/pages/playwrightHome.page.ts
async verifyTitleContainsPlaywright() {
  await this.page.getByRole('link', { name: 'NONEXISTENT_XYZZY' }).click({ timeout: 3000 });
  await expect(this.page).toHaveTitle(/Playwright/);
}
```

Confirm it fails:

```bash
$ npx playwright test tests/autonomous/3b231976/open-playwright-home.spec.ts
  1 failed
    TimeoutError: locator.click: Timeout 3000ms exceeded.
```

### The heal

```bash
npm run agent -- heal tests/autonomous/3b231976/open-playwright-home.spec.ts \
  --repo d6556bd8 \
  --page-object tests/autonomous/3b231976/pages/playwrightHome.page.ts
```

```
Repo: test-agent-poc (d6556bd8) — profile ✓

Submitting heal manifest…
  test:  tests/autonomous/3b231976/open-playwright-home.spec.ts
  page:  tests/autonomous/3b231976/pages/playwrightHome.page.ts

  [  0.0s] created
  [  1.5s] progress · started
  [ 13.6s] progress · baseline_done — 12217ms · passed=false · exit=1
  [ 13.6s] progress · classified — category=locator_drift
  [ 13.6s] progress · snapshot — 402ms                                ← Chromium visits target, captures a11y tree
  [ 18.1s] progress · heal_llm_done — $0.0015 · 9150+215 tok · 4426ms  ← LLM sees failure + a11y + repo profile
  [ 19.6s] progress · verify_done — 1278ms · passed=true · exit=0     ← patched test runs green
  [ 19.6s] succeeded — category=locator_drift

✓ Triage complete — patched test passes
  category: locator_drift
  patched: tests/triaged/e0ac2f15/open-playwright-home.spec.ts
  original (unchanged): tests/autonomous/3b231976/open-playwright-home.spec.ts

Compare:  diff tests/autonomous/3b231976/open-playwright-home.spec.ts tests/triaged/e0ac2f15/open-playwright-home.spec.ts
```

**19.6 seconds, $0.0015, one-line diff.** The original file is *never touched*. Compare and cherry-pick.

### The diff

```diff
     // Broken by smoke test: look for a link that doesn't exist
-    await this.page.getByRole('link', { name: 'NONEXISTENT_XYZZY' }).click({ timeout: 3000 });
+    await this.page.getByRole('link', { name: 'Get Started' }).click({ timeout: 3000 });
```

Precisely the minimum diff. Assertion untouched. Imports untouched. Method signature untouched. This is the "refuse to weaken" property in action.

### Trying refuse paths

**Assertion is wrong (site now says something different from what the test expects):**

```bash
# Change the POM to assert a title that will never match
$ npm run agent -- heal tests/autonomous/.../open-playwright-home.spec.ts --repo d6556bd8

  [ 19.6s] progress · classified — category=assertion_broken
  [ 19.6s] rejected — category=assertion_broken · reason: Refuse-to-heal: Assertion regex no longer matches the app text.

✗ rejected
  category: assertion_broken
  reason:
    Refuse-to-heal: Assertion regex no longer matches the app text.
```

Refused in 20 seconds. If the app changed, that's a product decision — not something an agent should silently paper over.

**Target unreachable:**

```bash
# Point page.goto at http://localhost:9999/does-not-exist
$ npm run agent -- heal tests/... --repo d6556bd8

  [  3.0s] progress · classified — category=infra
  [  3.0s] rejected — category=infra · reason: Refuse-to-heal: Target host is unreachable

✗ rejected
```

**3 seconds** — because the baseline run fails fast on ECONNREFUSED. Refusal doesn't cost the price of a real Playwright timeout.

**Test already passes:**

```bash
$ npm run agent -- heal tests/... --repo d6556bd8

  [  3.0s] progress · baseline_done — 1411ms · passed=true · exit=0
  [  3.0s] succeeded

✓ Triage: test already passes — nothing to heal
```

Fast-path exits before any LLM call. No token spent when there's nothing broken.

### The safe/refuse taxonomy

| Category | Behavior | Example |
|----------|----------|---------|
| `locator_drift` | Heal | Element renamed, moved, became ambiguous |
| `timing` | Heal | Race, missing wait |
| `assertion_broken` | Refuse | Fix would require weakening the assertion |
| `product_bug` | Refuse | Target returned 5xx, threw uncaught error |
| `infra` | Refuse | Target unreachable, browser crashed |
| `unknown` | Refuse | Classifier couldn't confidently label |

**Refuse-by-default when in doubt.** This is what keeps the platform trustworthy at scale.

### Cost of heals

| Path | Duration | Cost | Files mutated |
|------|----------|------|---------------|
| Heal (with a11y snapshot) | ~20 s | $0.0015 | 0 originals; 2 patched under `tests/triaged/…` |
| Refuse (infra) | ~3 s | $0 | 0 |
| Refuse (assertion_broken) | ~20 s | $0 | 0 (baseline runs, but no LLM call) |
| Already passing | ~3 s | $0 | 0 |

---

## Where everything lives

| Path | What's there |
|------|--------------|
| `local-artifacts/<manifestId>/` | Everything from one run: a11y snapshot, explorer trace, raw LLM response, generated files, judge output |
| `tests/autonomous/<shortId>/` | The generated spec + page object, copied here so Playwright can find them |
| `test-results/` | Playwright's own trace zips |
| Postgres `manifests` | State machine + terminal result |
| Postgres `manifest_events` | Event-sourced audit trail — one row per state transition |
| Postgres `llm_calls` | Per-call cost + tokens + latency + prompt hash |

## Common commands

```bash
# List recent manifests
npm run agent -- list

# Fetch full JSON for one manifest (events, result, timings)
npm run agent -- get 7287539e-4c90-454c-8e72-beaec25fe6d6

# Query the DB directly
docker exec test-agent-postgres psql -U platform -d platform \
  -c "SELECT id, status, LEFT(goal->>'description', 60) FROM manifests ORDER BY created_at DESC LIMIT 10;"

# Cost report for today
docker exec test-agent-postgres psql -U platform -d platform \
  -c "SELECT provider, model, COUNT(*), SUM(tokens_in), SUM(tokens_out), ROUND(SUM(cost_usd)::numeric, 4) FROM llm_calls WHERE ts::date = CURRENT_DATE GROUP BY 1, 2;"
```

## What the demo does NOT do yet

- **Refuse to weaken assertions.** Judge accepts a passing run whose assertions are all `.toBeVisible()` on `body`. Q2 will surface these.
- **Heal a failing test.** Right now failure = rejection. Q2's Triage Agent classifies failures and patches locator drift.
- **Match your repo's conventions.** The local RAG picker uses word overlap over `tests/`. Milestone B's Repo Onboarding extracts a real `RepoProfile` (POM style, locator preferences, fixtures).
- **Open a GitHub PR.** Files land in `local-artifacts/` and `tests/`. The PR flow is a later milestone.

## Part 5 — Suite health → batch heal → green (the full loop)

New in v0.4.0/v0.5.0: the Steward finds what's broken, batch heal fixes it,
and the next report proves it. Observed run (2 deliberately-broken POMs
seeded in `tests/batchdemo/`):

```bash
# 1. How bad is it?
$ npm run agent -- steward --runs 2

✓ Steward: suite health report ready
  3 tests × 2 runs — 1 healthy · 0 flaky · 2 always-failing · 0 skipped
  # report names both as locator_drift heal candidates

# 2. Heal everything the report flagged — one command
$ npm run agent -- batch --from-steward fd9cfb9a

  [ 31.8s] progress · child_done — 1/2 · tests/batchdemo/batch-a.spec.ts · ✓ patched · category=locator_drift
  [ 60.6s] progress · child_done — 2/2 · tests/batchdemo/batch-b.spec.ts · ✓ patched · category=locator_drift

✓ Batch complete — 2/2 patched · $0.0029
Apply all verified patches:  npm run agent -- apply --batch 73170857-…

# 3. Everything is still dry-run. Apply when the diffs look right:
$ npm run agent -- apply --batch 73170857-…
✓ overwrote tests/batchdemo/batch-a.spec.ts
✓ overwrote tests/batchdemo/pages/batch-a.page.ts
✓ overwrote tests/batchdemo/batch-b.spec.ts
✓ overwrote tests/batchdemo/pages/batch-b.page.ts
2/2 patches applied.

# 4. Prove it
$ npm run agent -- steward --runs 2

✓ Steward: suite health report ready
  5 tests × 2 runs — 5 healthy · 0 flaky · 0 always-failing
  ## Since last report (2026-07-03)
  - ✅ Fixed (2): batch demo A, batch demo B
```

Broken suite → diagnosed → healed → verified green, ~3 minutes and $0.003
end to end. Each child is a real triage manifest — `agent get <childId>`
shows its events, and the batch stops early if spend crosses `--max-cost`.

Batch can also run from a glob, no report needed:

```bash
npm run agent -- batch 'tests/**/*.spec.ts' --max-cost 2
```

## Cleanup

The generated tests live under `tests/autonomous/`. To clean them up:

```bash
rm -rf tests/autonomous
```

To wipe the entire local DB and start fresh:

```bash
bash scripts/dev-reset.sh
```

## Costs from this demo

Each successful run of the "click Get Started" example used **~$0.0014** of GPT-4o-mini tokens. At scale that puts a fully generated + tested spec well under a cent.
