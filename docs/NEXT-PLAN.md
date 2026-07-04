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
| 0.3 | Invite the second developer trial | The #1 reply already asks; [OUTREACH-KIT.md](./OUTREACH-KIT.md) has the pitch |

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
- Capture with [FEEDBACK-CAPTURE.md](./FEEDBACK-CAPTURE.md); file issues; fix
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

## Sprint 3b — #18 GitHub Action (est. ~2 days) → `v0.6.0-ci`

Pick this if the trial says "great, but nobody runs a laptop daemon".

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
| Temporal, WorkOS, gVisor pool, GitHub App PR flow | `infra/future/`, [Q1-TECHNICAL-DESIGN.md](./Q1-TECHNICAL-DESIGN.md) (v1 cloud) |
| pgvector semantic recall for RAG | installed, unused — revisit when generation quality plateaus |
| Auto-quarantine flaky tests | needs #16's trust signal first ([MILESTONE-D.md](./MILESTONE-D.md)) |
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
   └─ trial says "CI or bust" ──→ Sprint 3b: #18 action ──→ v0.7.0-ci
```
