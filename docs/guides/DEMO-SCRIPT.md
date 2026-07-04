# Demo script — 5 minutes for a QA lead

Rehearsable talk-track for a Loom recording. Optimized to show a QA lead **what the platform does for them**, not how the platform works internally.

**Total runtime target:** 5:00. Pauses eat time — plan to say less, not more.

---

## Before you record

1. Run `bash scripts/demo-reset.sh` — clean DB, no generated tests
2. In terminal A: `npm run dev` (leave running)
3. In terminal B: this script
4. Set your terminal font to at least 16pt so it reads in Loom
5. Close everything unrelated (Slack, notifications). One terminal, one browser, that's it.
6. Have a real Playwright repo checked out somewhere else that a QA lead would recognize — you'll `init` it live. (Falling back to this repo works but is less impressive.)
7. Rehearse once before recording

---

## Scene 1 — What this is (0:00 – 0:45)

**On screen:** just your face and the terminal, prompt visible.

**Say:**
> "I'm going to show you an agent that lives next to your Playwright test suite. It does three things — describes new tests in English, and writes them in your team's actual style. Fixes failing tests when the fix is safe. And refuses to touch tests when the fix would be unsafe. It runs on a laptop, uses your own OpenAI or Anthropic key, costs about a tenth of a cent per test.
>
> Let me show you what that looks like against a real Playwright repo."

**Timing:** 45 seconds. Practice this line so it flows.

---

## Scene 2 — Onboarding (0:45 – 1:45)

**On screen:** `cd` into a real Playwright repo (your test target).

**Type:**

```bash
npm run agent -- init . --name my-team-repo
```

**While it runs, say:**
> "First, I point the agent at my Playwright repo. It's going to read up to 20 of my existing tests and extract a profile of my team's conventions — locator style, POM structure, filename convention, fixtures. This is the piece that makes the agent write tests in my style, not some generic template."

**When it finishes (~12s):**

```
✓ Onboarding complete
  profileId:   ...
  confidence:  0.9
  files:       14
```

**Say:**
> "12 seconds, and it's already indexed my conventions. Let me show you what it learned — "

**Type:**

```bash
npm run agent -- repos
curl -s http://127.0.0.1:3001/v1/repos/<paste-shortid> | jq '.profile.structure, .profile.locators'
```

**Point at output. Say:**
> "It picked up that we use POM classes, kebab-case filenames, and prefer `getByRole` for locators — those are our real conventions, not defaults."

**Timing:** 1 minute exactly.

---

## Scene 3 — Add a test (1:45 – 3:15)

**Type (paste in one go):**

```bash
npm run agent -- add \
  "Click Get Started on the Playwright home page and verify the docs page loads with an Installation heading." \
  --url https://playwright.dev/ \
  --outcome "Installation heading is visible" \
  --max-steps 4 \
  --repo <shortId>
```

**While the events stream, say:**
> "I'm describing a test in English. The agent opens a real browser, drives the flow using GPT-4o-mini, watches what actually works, then writes a Playwright test that replays those exact steps in my repo's conventions. If any step fails — the browser can't verify the outcome, the generated test doesn't run green — the whole thing rejects. Nothing bogus lands in my test folder."

**When it finishes (~20s):**

```
✓ Coverage complete
  spec:  tests/autonomous/xxx/get-started-navigation.spec.ts
```

**Type:**

```bash
cat tests/autonomous/<xxx>/get-started-navigation.spec.ts
cat tests/autonomous/<xxx>/pages/get-started-navigation.page.ts
```

**Point at the code. Say:**
> "This is real Playwright. Accessible locators — `getByRole('link', { name: 'Get Started' })`, `getByRole('heading', { name: 'Installation' })`. Kebab-case filename matching my repo. POM class with an `expect` import — no missing dependencies. This is code I'd merge in a PR review."

**Type:**

```bash
npx playwright test tests/autonomous/<xxx>/get-started-navigation.spec.ts
```

**Say:**
> "And it passes."

**Timing:** 1:30.

---

## Scene 4 — Heal a failing test (3:15 – 4:30)

**Setup — before starting the recording, break the POM you just generated. In another terminal:**

```bash
# Point one of the locators at something that doesn't exist
sed -i.bak "s/'Getting Started'/'NONEXISTENT_LINK_XYZZY'/" \
  tests/autonomous/<xxx>/pages/get-started-navigation.page.ts
```

**On screen — resume recording. Type:**

```bash
npx playwright test tests/autonomous/<xxx>/get-started-navigation.spec.ts
```

**Show the failure. Say:**
> "Now let's say this test breaks. Maybe someone renamed the button. Playwright fails with a locator timeout. What I want an agent to do here is fix it — but only if the fix is safe. Not silently weaken an assertion, not paper over a real product bug."

**Type:**

```bash
npm run agent -- heal tests/autonomous/<xxx>/get-started-navigation.spec.ts \
  --repo <shortId> \
  --page-object tests/autonomous/<xxx>/pages/get-started-navigation.page.ts
```

**While it runs (~20s), say:**
> "The agent classifies the failure — this one's a locator drift. It launches a browser, snapshots the current page, then asks the LLM for the minimum patch. Never modifies my original file. Writes the patched version to a separate folder so I can diff it and cherry-pick."

**When it finishes:**

```
✓ Triage complete — patched test passes
  category: locator_drift
  patched: tests/triaged/xxx/get-started-navigation.spec.ts
  original (unchanged): tests/autonomous/xxx/get-started-navigation.spec.ts
```

**Type:**

```bash
diff tests/autonomous/<xxx>/pages/get-started-navigation.page.ts \
     tests/triaged/<xxx>/pages/get-started-navigation.page.ts
```

**Point at the diff. Say:**
> "One line changed. The broken locator name, replaced with `Getting Started` — the real link on the page. The assertion, the imports, the method signatures — untouched. This is what refuse-to-weaken looks like in practice."

**Timing:** 1:15.

---

## Scene 5 — The refuse case (4:30 – 5:00)

**Say:**
> "The whole thing turns on how it fails when it shouldn't heal. Let me show you that in 20 seconds."

**Type:**

```bash
# Break the assertion this time — regex that will never match
sed -i "s|/Playwright/|/AlwaysWrongExpectedTitleSmokeTestXYZ/|" \
  tests/autonomous/<xxx>/pages/get-started-navigation.page.ts

npm run agent -- heal tests/autonomous/<xxx>/get-started-navigation.spec.ts \
  --repo <shortId>
```

**When it rejects:**

```
✗ rejected
  category: assertion_broken
  reason:
    Refuse-to-heal: Assertion regex no longer matches the app text.
```

**Say:**
> "It refused. Because if the app now shows a different title than what the test expects, that's a product decision, and a QA agent silently changing assertions is exactly what I don't want.
>
> That's the demo. Cost of everything you just saw — under a penny. If this is interesting for your team, I've got three questions I'd love to ask you."

**Timing:** 30 seconds.

---

## Emergency rescues

Things that can go wrong during the recording, in order of likelihood:

| Symptom | Rescue |
|---------|--------|
| `POST /v1/tests` returns 500 | The dev tenant seed was missed. Kill the recording, run `bash scripts/demo-reset.sh`, start over |
| Coverage takes 45s+ (slower than script says) | Just narrate longer. Real agent latency varies; don't hide it |
| Coverage rejects with `outcomes_not_verified` | Retry with a simpler outcome ("Installation heading is visible" → "Docs page loads"), OR pick a different goal you've rehearsed |
| Playwright says "Browser not installed" | You forgot `npx playwright install chromium`. Stop, install, restart |
| Model doesn't include `expect` in POM | Old prompt cached — rebuild worker: pkill + relaunch |
| Terminal font too small in Loom | Stop recording. Zoom in with Cmd+Shift+= three times |

---

## Two-second version, if someone won't watch a Loom

If the QA lead responds "just tell me what it does" — say:

> "Point it at your Playwright repo. It reads your test conventions. Then you can either (a) describe a new test in English and it writes real, style-matching code, or (b) point it at a failing test and it either fixes it or refuses with a clear reason. Runs on a laptop, costs about a tenth of a cent per test."

Then follow up with: "Which of those two would matter more to your team?" and listen.

---

## Post-recording

1. Watch it yourself once. If any scene is longer than the estimate, re-record the offender rather than the whole thing.
2. Cover the video with a 10-word title: **"Agent that writes Playwright tests in your team's style."**
3. Share via [OUTREACH-KIT.md](../outreach/OUTREACH-KIT.md).
4. Log responses in [FEEDBACK-CAPTURE.md](../outreach/FEEDBACK-CAPTURE.md).
