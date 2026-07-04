# Outreach kit — how to share the demo with 3–5 QA leads

Everything below assumes the [DEMO-SCRIPT.md](../guides/DEMO-SCRIPT.md) recording is done and uploaded. This is the sharing playbook.

The goal isn't to sell. The goal is to **learn what a real QA lead thinks after watching what already exists** — before you spend two more months building the next agent.

Rules of engagement:
- **No calendar spam.** Send the Loom, ask 3 questions, respect their time.
- **Say the price out loud.** "This runs on a laptop, costs about a tenth of a cent per test." Numbers unlock brains.
- **Don't fix objections during outreach.** Capture the objection verbatim, thank them, move on.
- **Don't offer to install for them.** The product isn't yet cloud-hosted; setting up locally on their machine wastes both your time and theirs.

---

## The 2-line pitch

Use this everywhere — DM, email subject, intro to the Loom itself.

> **"An agent that writes and heals Playwright tests in your team's actual style. Not from a template — from your existing conventions."**

Do not say: "AI-powered test generation." That phrase now means nothing.
Do not say: "Save 40% of your QA time." You have no data yet.
Do not say: "GPT-powered." Say what it does, not how.

---

## DM variants

Pick the version matching the relationship. Length in seconds-to-read.

### V1 — Cold outreach (10s)

> Hey [Name] — I built a Playwright agent for QA teams. It reads your repo's conventions, then either writes new tests in that style or heals failing ones (or refuses with a clear reason). Cheap enough to run per-test — about a tenth of a cent.
>
> 5-min demo if you're curious: [Loom link]
>
> Not selling anything. Just want a QA lead's honest reaction before I build the next thing.

### V2 — Warm intro (15s)

> Hey [Name] — [Mutual] said you'd have opinions on this. I've been building a Playwright agent that acts more like an SDET pair than a code generator — reads your repo's conventions, writes tests in that style, heals broken ones, and refuses to touch anything that would need weakening an assertion.
>
> Local-only demo (no signup): [Loom link]
>
> I'm not pitching yet — just want to know if it feels like something your team would use or if I'm building the wrong thing.

### V3 — Following up with a QA lead you know (5s)

> [Name] — 5 minutes of your time in exchange for honest feedback? Playwright agent, watches your repo, writes / heals tests in your style. Runs on a laptop. [Loom]

---

## The 3 questions to ask after they watch

Send these as a follow-up message once they've watched. Do not ask them all in one paragraph — one question per bubble.

### Question 1 — the wedge check

> "If your team had this exact thing today, which of the two would matter more — describing new tests, or healing broken ones?"

**Why:** Tells you which milestone is the actual wedge for their team. Coverage-vs-Triage skew varies a lot by team size and suite age.

**What to listen for:**
- "Heal — our biggest problem is maintenance" → Triage-first sales motion, Steward becomes the roadmap
- "Add — we barely have coverage" → Coverage-first, Onboarding is the differentiator
- "Both" → they haven't thought about it yet; not a signal

### Question 2 — the trust check

> "Watching the refusal in the last scene — where it refused to touch the broken assertion — was that reassuring or annoying?"

**Why:** The refuse-by-default property is what makes the platform trustworthy at scale. If they find refusals annoying, the whole "won't silently ship a bad heal" story doesn't sell.

**What to listen for:**
- "Reassuring" → the pitch works
- "Annoying, I want a suggestion I can accept or reject" → build the diff-review UI before you ship
- "I'd never trust an agent to skip cases, refuse everything by default" → wrong buyer or wrong product

### Question 3 — the buying-signal check

> "If it did just those two things — coverage + heal — would you (a) install it today for your team, (b) install it once it's cloud-hosted, or (c) it's cool but not something you'd pay for?"

**Why:** Cuts through niceness. "Install today" is a strong intent signal; "when cloud" tells you they're a real buyer waiting for the productized version; "not something I'd pay for" tells you to change direction or targeting.

**What to listen for:**
- (a) → sit down and figure out what free-tier gets them into the door
- (b) → what's their max monthly spend on a QA tool? Are they using anything like Momentic / Meticulous / QA Wolf?
- (c) → why not? Cost? Trust? Not their pain? Every answer here is gold

**Do not argue with any answer.** Log verbatim. Say "That's really helpful, thanks." Move on.

---

## Where to send it

Rough priority order — send to whoever you already know first.

1. QA leads / SDET managers you've worked with directly
2. Playwright-adopting orgs in your network (search LinkedIn for "SDET Playwright" in your extended network)
3. Public Playwright Discord + Reddit — but only after 2+ warm sends. Public feedback is louder but less honest.
4. QA leads at companies with public Playwright test suites on GitHub (they know their conventions matter)

Skip: agencies (different buying pattern), open-source maintainers (already sold on Playwright, don't have the maintenance pain), non-QA engineering leaders (they'll say "cool, ask my QA lead").

---

## Two things you might get wrong

### Trying to fix objections in real time

If a QA lead says "but I use fixtures, does it read those?" — the honest answer is "the profile extractor picks up fixture names but doesn't wire them into generation yet." **Say that. Don't oversell.** They asked because they're vetting, not because they need a workaround right now.

### Building the requested feature immediately after one conversation

If one QA lead says "I'd install this today if it opened a real GitHub PR" — do not go build the GitHub App tomorrow. Log it. Wait for 2 more people to say the same thing. **Feature requests from a single lead are always a bad signal; feature requests from three are a roadmap.**

---

## After you have 3 responses

The next doc to write is **not** a roadmap. It's a one-page "here's what 3 QA leads said, here's what surprised me, here's the pattern." Then decide what to build next based on that pattern.

If the pattern is:
- **"Both features matter but heal was the killer"** → Milestone C follow-ups (bulk heal from CI list, LLM-backed classifier) + Steward for weekly reports
- **"Style-matching is the whole thing, don't touch anything else"** → per-subdirectory profiles, fixture wiring, GitHub PR flow
- **"Refuse-by-default is what I actually want"** → double-down on the taxonomy: reviewer agent that summarizes what changed, richer categories, "why refuse" explanations
- **"Cool but not for me"** → either the wrong buyer segment, or the platform is a feature not a product; regroup before building

Capture every response in [FEEDBACK-CAPTURE.md](./FEEDBACK-CAPTURE.md).
