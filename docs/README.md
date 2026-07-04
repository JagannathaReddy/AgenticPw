# Documentation index

**Current release:** `v0.7.0-ci`. Start with the root [README](../README.md) for
the quick start; come here for depth.

## guides/ — living how-tos

| Doc | Read it when |
|-----|--------------|
| [DEMO.md](guides/DEMO.md) | You want the full walkthrough of every flow, with real observed output (7 parts: coverage → onboarding → profile-driven coverage → heal → batch → feedback → CI) |
| [DEMO-SCRIPT.md](guides/DEMO-SCRIPT.md) | You're recording a 5-minute demo for a QA lead |
| [SECURITY-CI.md](guides/SECURITY-CI.md) | You're wiring the heal action into GitHub Actions (key handling, budget cap, fork-PR rules) |

## planning/ — what's next

| Doc | Read it when |
|-----|--------------|
| [NEXT-PLAN.md](planning/NEXT-PLAN.md) | You want the post-Q1 roadmap and what shipped against it (Sprints 1/3a/3b ✅; Sprint 2 = developer trial, pending) |
| [ISSUE-DEFERRALS.md](planning/ISSUE-DEFERRALS.md) | Historical record of issue-thread comments; everything once deferred has since shipped |

## milestones/ — release snapshots (historical)

| Doc | Covers |
|-----|--------|
| [v0.1.0-coverage.md](milestones/v0.1.0-coverage.md) | Coverage + Onboarding — describe a test in English, get code |
| [v0.2.0-triage.md](milestones/v0.2.0-triage.md) | Triage — heal failing tests or refuse safely |
| [v0.4.0-steward.md](milestones/v0.4.0-steward.md) | Steward — suite health, flaky vs broken |
| [RETROSPECTIVE.md](milestones/RETROSPECTIVE.md) | Honest post-mortem after v0.1.0 — what the plan got wrong |

Later releases (v0.5.0-batch, v0.6.0-feedback, v0.7.0-ci) are documented as
[DEMO.md](guides/DEMO.md) parts 5–7 and their git tags rather than separate
snapshot docs.

## design/ — the Q1 design (reference)

| Doc | Status |
|-----|--------|
| [Q1-TECHNICAL-DESIGN.md](design/Q1-TECHNICAL-DESIGN.md) | The original cloud-SaaS design. The **v0 scope note at the top is load-bearing**: what's built is the laptop-first re-scope; the cloud shape is the v1 target |
| [Q1-SEQUENCE-DIAGRAMS.md](design/Q1-SEQUENCE-DIAGRAMS.md) | Mermaid sequence/state diagrams for every flow |
| [Q1-WEEK-BY-WEEK-PLAN.md](design/Q1-WEEK-BY-WEEK-PLAN.md) | The original staffing/burndown plan (historical) |

## outreach/ — sharing + feedback

| Doc | Read it when |
|-----|--------------|
| [OUTREACH-KIT.md](outreach/OUTREACH-KIT.md) | You're sharing the demo with QA leads |
| [FEEDBACK-CAPTURE.md](outreach/FEEDBACK-CAPTURE.md) | You're about to talk to a user and want comparable notes |
| [feedback/](outreach/feedback/) | Per-conversation notes land here |

## Co-located docs (not in this folder)

- [prompts/README.md](../prompts/README.md) + [prompts/VERSIONING.md](../prompts/VERSIONING.md) — prompt authoring and rollout
- [sql/migrations/README.md](../sql/migrations/README.md) — migration runner semantics + authoring checklist
- [packages/eval-harness/README.md](../packages/eval-harness/README.md) — prompt eval corpus runner
- [packages/rls-tests/README.md](../packages/rls-tests/README.md) — tenant-isolation test suite
- [infra/future/README.md](../infra/future/README.md) — parked cloud Terraform
