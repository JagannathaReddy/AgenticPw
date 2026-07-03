# Documentation index

**Current release:** `v0.2.0-triage`.

## Start here

| Doc | When to read |
|-----|--------------|
| [../README.md](../README.md) | Install, quick start, top-level layout |
| [DEMO.md](./DEMO.md) | 4-part walkthrough with real output — coverage → onboarding → profile-driven coverage → heal |
| [MILESTONE-STATUS.md](./MILESTONE-STATUS.md) | What shipped in v0.1.0 (Coverage + Onboarding) — real vs stub, KPIs, run book |
| [MILESTONE-C.md](./MILESTONE-C.md) | What shipped in v0.2.0 (Triage) — safe/refuse taxonomy, 4-smoke matrix |

## For sharing with QA leads

| Doc | Purpose |
|-----|---------|
| [DEMO-SCRIPT.md](./DEMO-SCRIPT.md) | 5-minute rehearsable talk-track for the Loom |
| [OUTREACH-KIT.md](./OUTREACH-KIT.md) | Pitch, DM variants, the 3 questions to ask |
| [FEEDBACK-CAPTURE.md](./FEEDBACK-CAPTURE.md) | Per-conversation template + pattern doc after N=3 |
| [feedback/](./feedback/) | Individual QA-lead notes go here |

## Design references (v1 SaaS target)

| Doc | Purpose |
|-----|---------|
| [Q1-TECHNICAL-DESIGN.md](./Q1-TECHNICAL-DESIGN.md) | Cloud target architecture — Temporal, WorkOS, multi-tenancy. Not needed for local dev; the design that v1 lifts to. |
| [Q1-SEQUENCE-DIAGRAMS.md](./Q1-SEQUENCE-DIAGRAMS.md) | Mermaid sequence + state diagrams for the workflows |
| [Q1-WEEK-BY-WEEK-PLAN.md](./Q1-WEEK-BY-WEEK-PLAN.md) | 13-week execution plan for the v1 target |

## Retrospective

| Doc | Purpose |
|-----|---------|
| [RETROSPECTIVE.md](./RETROSPECTIVE.md) | Honest post-mortem after v0.1.0 — real bugs, decisions that held, decisions to revisit |

## Overview of what runs

```
CLI (`test-agent`)  ──►  Fastify API :3001  ──►  Postgres 16 (RLS)
                                  │                       ▲
                                  ▼                       │
                          manifests (pending)             │
                                  │                       │
                                  ▼                       │
                          Worker (poll)  ────────────────┘
                                  │
                 ┌────────────────┼────────────────┬─────────────────┐
                 ▼                ▼                ▼                 ▼
           Coverage flow    Onboarding flow   Triage flow       (future)
           (Explorer→       (scan + extract)  (classify→snap→   Steward
            Gen→Judge)                         heal→verify)     agent
                 │                │                │
                 ▼                ▼                ▼
           Chromium + LLM shim (Anthropic/OpenAI)
                 │                                 │
                 ▼                                 ▼
           local-artifacts/               tests/triaged/
```

Everything except Chromium runs in tsx dev processes. Two Node processes, one Docker container, no cloud.
