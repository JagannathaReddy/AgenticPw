# Post-Q1 plan — remaining tasks

Q1 closed at `v0.4.0-steward`: all four flows (Coverage, Onboarding, Triage +
Improve, Steward) ship and are smoke-proven. This plans what's left, in
dependency order. Estimates assume the same one-laptop, one-session working
style that shipped v0.2.1 → v0.4.0.

---

## Track 0 — manual, ~10 minutes (unblocks everything social)

| # | Task | How |
|---|------|-----|
| 0.1 | Close issue #1 | Paste the closing comment from [ISSUE-DEFERRALS.md](./ISSUE-DEFERRALS.md) |
| 0.2 | Mark #14/#16/#18 as roadmap | Paste the three deferral comments from the same doc |
| 0.3 | Invite the second developer trial | The #1 reply already asks; [OUTREACH-KIT.md](../outreach/OUTREACH-KIT.md) has the pitch |

Nothing below strictly blocks on this, but 0.3 gates Sprint 2's priority call.

---

## Sprint 1 — #14 `agent batch` (est. ~2 days) → `v0.5.0-batch`

**Why first:** Steward just created the demand. A health report that names
5 heal candidates and then makes the user run `agent heal` 5 times is half a
feature. Batch heal completes the Steward → Triage handoff.

**Design notes (cheaper than the deferral comment estimated):**
- `manifests.parent_manifest_id` already exists with an index — fan-out is
  "insert 1 orchestrator manifest + N child triage manifests", **no migration**.
- The single-threaded worker processes children sequentially. That's fine for
  v0: predictable cost, no browser contention on a laptop. Concurrency is a
  later knob, not a blocker.

**Slices:**
1. **Orchestrator workflow** (role `orchestrator`, already in the role check):
   expand a spec list, insert child triage manifests, then poll children;
   roll up terminal state (`succeeded` if ≥1 child patched, result carries
   per-child outcomes). Budget: stop inserting/waiting when the batch's
   `maxCostUSD` (sum of children's spend from `llm_calls`) trips.
2. **API** `POST /v1/batches { specs?: string[], glob?: string, fromManifestId?: string, repoId? }` —
   `fromManifestId` reads a steward report's heal candidates (the
   `steward-report.json` artifact already lists verdict + category per test).
3. **CLI** `agent batch --from-steward <manifestId>` and
   `agent batch 'tests/**/*.spec.ts'`: table view (one row per child,
   live-updating is overkill — print rows as children finish), final
   `X/Y patched · $cost · apply-all hint`.
4. **`agent apply --batch <batchId>`** — apply every verified child patch.
5. **Smoke:** steward on a suite with 2 broken locators → batch from that
   report → 2 diffs → apply-all → steward again → green. That's the full
   loop demo and the DEMO.md addition.

**Ride-along (small):** Steward **trend deltas** — compare against the
previous report for the same repo (`test_results` by `(workspace, file,
title)` already supports the query); one section in the report: "new flakes /
fixed since last report".

---

## Sprint 2 — second developer trial (est. 0 build days, calendar-gated)

**Why now:** v0.2.1 fixed the 9 blockers, #10 fixed the architectural gap the
trial exposed, `agent doctor` exists, and batch heal (Sprint 1) is exactly the
feature that suite's 5-layer helper structure wants. Validation beats more
features.

- Re-run on the same Windows machine + internal suite from issue #1.
- Capture with [FEEDBACK-CAPTURE.md](../outreach/FEEDBACK-CAPTURE.md); file issues; fix
  the quick ones as a `v0.5.1` patch batch (same playbook as v0.2.1).
- **Decision gate:** what the trial complains about decides whether Sprint 3
  is #16 (heal quality) or #18 (CI mode). Don't pre-commit.

---

## Sprint 3a — #16 feedback loop (est. ~3 days) → `v0.6.0-feedback` ✅ SHIPPED 2026-07-04

Picked ahead of the Sprint 2 trial by explicit call ("Start #16"). All four
slices landed; see DEMO.md Part 6 for the observed run and the `feedback`
eval tag for the with/without proof.

1. Migration 0013: `heal_feedback` (workspace, repo, manifest, verdict
   up/down, category, note, created_at) — RLS, append-only.
2. `agent feedback <manifestId> --up|--down [--note "..."]`;
   `agent apply` records an implicit `--up`.
3. Healer retrieval: last N feedback rows for the repo injected into the
   prompt (same pattern as `related_sources` from #10).
4. Eval slice: corpus of (failure, expected verdict) pairs; measure
   refuse-accuracy with/without feedback — otherwise the feature is vibes.

## Sprint 3b — #18 GitHub Action (est. ~2 days) → `v0.7.0-ci` ✅ SHIPPED 2026-07-04

Picked by explicit call ("Start #18") right after 3a. Composite action
`.github/actions/heal`, CLI `--format github`, dogfood workflow
`heal-on-failure.yml`, [SECURITY-CI.md](../guides/SECURITY-CI.md).

1. Composite action: Postgres service container + migrations + seed on boot.
2. CLI `--format=github-actions`: `::error` annotations + job-summary
   markdown instead of ANSI diffs; exit codes already correct.
3. Secrets/budget doc (`SECURITY-CI.md`): LLM key as GH secret, per-run
   `maxCostUSD`, `NO_CACHE` between runs; `actions/cache` around
   `local-artifacts/cache/`.
4. Dogfood: run Steward weekly + heal-on-failure on this repo's own CI.

---

## Explicitly parked (unchanged from Q1 decisions)

| Item | Where it's tracked |
|------|--------------------|
| Temporal, WorkOS, gVisor pool, GitHub App PR flow | `infra/future/`, [Q1-TECHNICAL-DESIGN.md](../design/Q1-TECHNICAL-DESIGN.md) (v1 cloud) |
| pgvector semantic recall for RAG | installed, unused — revisit when generation quality plateaus |
| Auto-quarantine flaky tests | needs #16's trust signal first ([MILESTONE-D.md](../milestones/v0.4.0-steward.md)) |
| Scheduled weekly steward | cron locally; Temporal cron in v1 |

## Sequence at a glance

```
Track 0 (manual, 10 min)
   │
Sprint 1: #14 batch heal + steward trends ──→ v0.5.0-batch
   │
Sprint 2: developer trial #2 ──→ v0.5.1 quick fixes
   │
   ├─ Sprint 3a: #16 feedback ──→ v0.6.0-feedback ✅ (started early by request)
   └─ Sprint 3b: #18 action   ──→ v0.7.0-ci ✅ (started early by request)
```

Both Sprint 3 tracks shipped before the Sprint 2 trial ran — the trial (still
worth doing) now validates the whole surface instead of choosing between
halves of it.

---

# Post-v0.7 plan (2026-07-06) — no infra track

Cloud v1 (Temporal, WorkOS, gVisor, GitHub App) stays parked in
`infra/future/` — explicitly out of scope for this plan. Everything below is
laptop-first and comes from a deferral already recorded in the repo.

## Sprint 4 — steward in CI (est. ~½ day) → `v0.8.0-steward-ci` ✅ SHIPPED 2026-07-06

The README's own flag: "the CI schedule covers heal; steward-in-CI is a
small follow-up." Completes the CI story — a weekly suite-health report
lands in the job summary, with heal candidates one click from the batch
action.

1. `agent steward --format github`: health counts + verdict table + heal
   candidates + trend deltas into `$GITHUB_STEP_SUMMARY`; `GITHUB_OUTPUT`
   carries the manifest id + candidate count so a workflow can chain into
   `agent batch --from-steward`.
2. Generalize `.github/actions/heal` with a `mode: heal | steward` input
   (bootstrap steps are identical; only the final command differs).
3. `suite-health.yml`: weekly + manual dispatch, secret-gated like
   heal-on-failure, uploads `steward-report.json` as an artifact.

## Sprint 5 — auto-quarantine flaky tests (est. ~2 days) → `v0.9.0-quarantine` ✅ SHIPPED 2026-07-06

Parked at v0.4.0 because "writing to specs crosses the trust-rung boundary;
needs the #16 feedback loop first." #16 shipped — the blocker is gone, and
the shape follows the heal pattern exactly:

1. Steward already names flaky tests; add `agent quarantine --from-steward
   <id>` producing a dry-run diff that wraps each flaky test in
   `test.fixme(...)` (or `test.skip` with a dated reason comment) — never
   deletes, never edits test bodies.
2. `agent apply` (existing) commits the diff; the apply records feedback so
   a wrong quarantine teaches the analyzer like a wrong heal does.
3. Steward report gains a "quarantined" section so skipped tests stay
   visible instead of silently rotting; un-quarantine = a normal heal once
   the test goes green K runs in a row (report suggests it).
4. Smoke: flaky demo test → quarantine diff → apply → suite green →
   steward shows it under quarantined, not healthy.

## Sprint 6 — feedback grows the eval corpus (est. ~1–2 days) → `v0.10.0-eval-loop` ✅ SHIPPED 2026-07-06

The unbuilt "optional" half of issue #16: today feedback teaches the
*healer prompt*; it should also grow the *eval corpus* so prompt changes
are scored against real-world failures, not just the hand-written triples.

1. `agent feedback --promote <manifestId>`: turn a rated heal's
   (failure, spec, verdict) into an anonymized eval triple under
   `prompts/eval/corpus/` — thumbs-down heals become counter-examples
   (the most valuable kind).
2. Eval report gains a "real-world slice" section: accept-rate on promoted
   triples vs hand-written ones.
3. Guardrail: `--promote` prints the triple for review before writing —
   corpus entries are code, they go through git like everything else.

## Standing items (not sprints)

| Item | Trigger |
|------|---------|
| Developer trial #2 | Calendar — still the highest-value validation; now covers batch + feedback + CI + (post-Sprint 4) steward-in-CI |
| pgvector semantic RAG | A trial user with a big suite says generated tests miss their conventions despite good examples existing |
| Migration tracking runner | Re-run pain recurs (sql/migrations/README.md records the constraint-superset footgun) |
| Batch concurrency knob | A suite where sequential child heals are the bottleneck |

## Sequence

```
Sprint 4: steward-in-CI      ──→ v0.8.0-steward-ci   (~½ day)
   │
Sprint 5: auto-quarantine    ──→ v0.9.0-quarantine   (~2 days, unblocked by #16)
   │
Sprint 6: feedback→eval loop ──→ v0.10.0-eval-loop   (~1–2 days)

Developer trial #2 runs whenever calendar allows — it doesn't block any
sprint, and each shipped sprint makes it more informative.
```

---

# Q2-remaining plan (2026-07-06) — laptop-first re-interpretation

The original Q2 (cloud plan) had six items. Triage shipped long ago and was
exceeded (batch, feedback, quarantine). This plans the rest, translated to
the laptop architecture; anything that only makes sense as a multi-team
cloud service stays parked with its reason on record.

## Disposition of original Q2 line items

| Original Q2 item | Disposition |
|---|---|
| Triage Agent | ✅ shipped v0.2.0, exceeded through v0.10.0 |
| Trust ladder rungs 2–5 | **Sprint 7** (rungs 2–3; 4–5 parked — see below) |
| OPA policy engine | **Folded into Sprint 7** as a code-level policy evaluator; OPA-as-a-service parked (a policy *server* pays off with many services; we have two processes) |
| Vector semantic recall | **Sprint 8** — pgvector finally earns its keep |
| Slack App | **Sprint 9** as a webhook notifier; full Slack App (OAuth, slash commands) parked to cloud |
| Prompt registry service | Parked — files + hash + eval already give solo-scale guarantees; a registry adds value when multiple teams publish prompts |
| Eval ownership → QA infra team | N/A solo |

## Sprint 7 — trust rungs 2–3 + policy enforcement (est. ~2 days) → `v0.11.0-trust` ✅ SHIPPED 2026-07-06

The design doc defined rung 1 only ("draft, review before merge" — today's
dry-run + `apply`). Laptop-first ladder:

- **Rung 1 (today):** dry-run diff; human runs `apply`.
- **Rung 2 — auto-apply:** a verified heal/quarantine applies itself
  (records the implicit 👍). Opt-in per submission (`--auto-apply`) and
  honored only when `manifest.policy.trustRung >= 2`.
- **Rung 3 — opens a PR:** CI heal mode gains `open-pr`: patched files
  pushed to a branch + PR via github-script (`contents: write`). The
  `canWritePR` policy flag finally does something.
- **Rungs 4–5 (auto-merge / unattended):** parked — they encode
  organizational trust, not code; nothing to build solo.

Policy evaluator (the OPA-intent, no OPA): one `policy.ts` module the
worker consults — refuseCategories (today: scattered), per-manifest
maxCostUSD enforced in the LLM shim (today: only batch aggregates spend),
trustRung gating the apply behavior. Pure + unit-tested.

## Sprint 8 — semantic RAG on pgvector (est. ~2 days) → `v0.12.0-semantic-rag`

Q2's "vector semantic recall", buildable and *provable* without waiting for
a trial: the eval harness is the judge.

1. Onboarding embeds spec files into `test_file_embeddings`
   (text-embedding-3-small; metered like LLM calls).
2. Generator few-shot picker: cosine similarity first, keyword-overlap
   fallback when embeddings are absent (repo not re-onboarded) or the
   API is unavailable — the v0 contract in rag-examples.ts already
   promised exactly this swap.
3. Feedback retrieval: most-similar-to-current-failure rows instead of
   most-recent when a repo has >N feedback rows.
4. **Proof or it didn't happen:** A/B eval slice — same generation goals,
   keyword picker vs semantic picker, style-conformance scored. If the
   slice shows no lift on this repo, we say so in the report and gate the
   default on a bigger-suite trial.

## Sprint 9 — webhook notifications (est. ~½ day) → `v0.13.0-notify`

The Slack-App intent at laptop scale: `NOTIFY_WEBHOOK_URL` env (Slack
incoming-webhook compatible). Worker posts terminal summaries — steward
health headline, batch X/Y patched, quarantines applied. No OAuth, no app
review, works with Slack/Discord/Teams. The full Slack App stays a cloud
deliverable.

## Sequence

```
Sprint 7: trust rungs 2–3 + policy ──→ v0.11.0-trust        (~2 days)
   │
Sprint 8: semantic RAG + A/B proof ──→ v0.12.0-semantic-rag (~2 days)
   │
Sprint 9: webhook notifications    ──→ v0.13.0-notify       (~½ day)
```

Ordering rationale: Sprint 7 is signal-independent and closes the gap
between what `manifest.policy` *records* and what the system *enforces*;
Sprint 8 carries its own proof via the eval harness; Sprint 9 is a
quality-of-life capstone. The developer trial remains the standing
validation item and can land anywhere in this sequence.
