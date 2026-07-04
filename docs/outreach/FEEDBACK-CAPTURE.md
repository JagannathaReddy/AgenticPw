# Feedback capture — how to record what QA leads said

One template per person. Use one file per conversation (`docs/outreach/feedback/2026-07-<date>-<initials>.md`), or drop them into a shared doc. The point is that after 3 conversations you can put them side-by-side and see the pattern.

Rules:
- **Capture verbatim.** "Sounds cool" and "I'd install this today" are very different signals; paraphrasing loses that.
- **Never edit answers to make them match your priors.** The whole point is to be surprised.
- **Log even bad conversations.** A "not interested" from a QA lead in a matching profile tells you as much as a yes.

---

## Template — copy this for each conversation

```markdown
## Feedback: <name> (<role>, <company>)

- **Date:** YYYY-MM-DD
- **Channel:** cold DM / warm intro / mutual / other: ___
- **Time to first reply:** e.g. same day, 3 days
- **Watched the Loom?** yes / partial / no
- **Company Playwright suite size:** small (<50) / medium (50–500) / large (500+)  / unknown

---

### Q1 — Coverage vs Triage wedge

*"If your team had this exact thing today, which of the two would matter more — describing new tests, or healing broken ones?"*

> [verbatim answer]

**Signal:** coverage_wedge / triage_wedge / both / unclear

---

### Q2 — Refusal reaction

*"Watching the refusal in the last scene — where it refused to touch the broken assertion — was that reassuring or annoying?"*

> [verbatim answer]

**Signal:** reassuring / mixed / annoying / wanted_diff_review

---

### Q3 — Buying intent

*"If it did just those two things — coverage + heal — would you (a) install it today, (b) install it once it's cloud-hosted, or (c) it's cool but not something you'd pay for?"*

> [verbatim answer]

**Signal:** install_now / wait_for_cloud / no_pay / no_fit

---

### Anything they volunteered without being asked

*[Quotes and context. This section is often the most valuable.]*

> [verbatim]

---

### Objections raised

*[Any doubt or concern. Do NOT reply to it during outreach — just log.]*

- [ ] [objection]
- [ ] [objection]

---

### Follow-up next step

- [ ] Send them the repo link (only if they explicitly asked)
- [ ] Offer a 15-min call (only if they explicitly asked)
- [ ] Thank + move on (default)
- [ ] Other: ___

---

### My own reflection (after the conversation, not during)

*What surprised me?*

*What did I over/underestimate?*

*Would I still target this persona? Why?*
```

---

## After 3 conversations — the pattern doc

Create `docs/outreach/feedback/PATTERN-SUMMARY.md` and fill it in.

```markdown
## After N=3 feedback conversations

### Consensus signal (across all 3)

| Question | Answers | Pattern |
|----------|---------|---------|
| Q1 wedge | 2× triage / 1× coverage | Lean triage-first |
| Q2 refusal | 3× reassuring | Refuse-by-default plays well |
| Q3 buying | 2× wait_for_cloud / 1× no_pay | Real signal but not $ today |

### What surprised me

1. …
2. …

### Unsolicited themes (mentioned without being prompted)

- [theme 1] — mentioned by N/3
- [theme 2] — mentioned by N/3

### Personas that DIDN'T fit

*What kind of QA lead should I NOT reach out to next round?*

### Decision — what to build next

**Option chosen:** ___

**Why:** ___

**What I'm NOT building:** ___
```

---

## Signals to weight heavily

### Strong buying signals

- **"When can I install it?"** — the strongest possible
- **"Can I show my team?"** — usually true; unusually strong
- **"How much would this cost when it's hosted?"** — real qualifying
- **"Does it work with [specific stack detail]?"** — a technical evaluator; if you can support it, you have a champion
- **"Have you talked to X?"** — they're referring you; return the favor

### Strong "wrong direction" signals

- **"Interesting, but we solved this internally"** — market is too advanced or you're targeting late-adopters
- **"How is this different from Copilot?"** — you didn't explain the differentiation clearly enough (or the demo didn't); rewrite the pitch
- **"Neat, but we don't have that problem"** — wrong persona or wrong pain
- **"I don't trust an agent to change our tests"** — the refuse story didn't land; maybe you need to show more refuse footage

### Weak/mixed signals

- **"Cool!"** — meaningless
- **"I'll show my team"** — usually false; discount 90%
- **"Let me know when it's ready"** — sometimes real, mostly polite
- **"Send me more info"** — often a stall; ask a specific question back to see if they engage

---

## What not to do with feedback

- **Do not build the requested feature immediately.** One request from one lead is noise; three is a roadmap.
- **Do not argue with a "no."** Log it, thank them, move on.
- **Do not send follow-ups to non-responders more than once.** They saw it and skipped it — that IS the feedback.
- **Do not delete "harsh" feedback.** The most valuable line you'll get in this exercise is a specific reason the demo didn't sell. Preserve it.

---

## The one metric you should track

**"How many QA leads said they'd install it today, without qualification?"**

- 0 out of 5 → the product isn't yet a product; do more discovery, less building
- 1 out of 5 → normal for a demo; find 5 more of that lead's shape
- 2 out of 5 → you have a segment; go find more of them
- 3+ out of 5 → build the install path, not more features
