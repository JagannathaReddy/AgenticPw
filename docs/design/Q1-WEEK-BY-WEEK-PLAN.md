# Q1 Week-by-Week Plan

Companion to [Q1-TECHNICAL-DESIGN.md](./Q1-TECHNICAL-DESIGN.md) and [Q1-SEQUENCE-DIAGRAMS.md](./Q1-SEQUENCE-DIAGRAMS.md). This is the staffing + burndown plan.

**Duration:** 13 weeks (91 calendar days)
**Team:** 8 people (see §Team allocation)
**Ship gate:** 5 design partners in production; 100 tests generated end-to-end; zero cross-tenant incidents.

---

## Team allocation

| Role | Person | Focus |
|------|--------|-------|
| **Tech Lead** | TL | Architecture reviews, unblocking, code review gate |
| **Platform Eng 1** | P1 | API, Temporal workflows, tenancy |
| **Platform Eng 2** | P2 | Data layer, RLS, migrations, memory service |
| **Agent Eng 1** | A1 | Explorer + Generator + prompts |
| **Agent Eng 2** | A2 | LLM Gateway, Judge, eval harness |
| **Infra / SRE** | S1 | K8s, gVisor, browser pool, secrets, observability |
| **Frontend / DevRel** | F1 | CLI, GitHub App UX, partner onboarding, docs |
| **PM** | PM | Partner comms, requirements, cross-team coordination |

Not on this plan: designer (Q2), founding SDET (starts week 8).

---

## Phase overview

| Phase | Weeks | Milestone |
|-------|-------|-----------|
| **Phase 1: Foundation** | 1–4 | Internal alpha runs on team's own repo |
| **Phase 2: Partner 1** | 5–6 | First design partner shipping tests |
| **Phase 3: Ramp** | 7–9 | 2–3 partners live; SLOs steady |
| **Phase 4: Steady state + Q2 prep** | 10–13 | 4–5 partners; Q2 kickoff artifacts |

---

## Week 1 — Bootstrap

**Goal:** Repos, CI, K8s, secrets stood up. Nothing runs yet.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Monorepo scaffolding (TS, workspaces) | TL | `apps/api`, `apps/gateway`, `packages/*` skeleton with lint + build green |
| AWS accounts (dev, staging, prod) | S1 | Terraform baseline: VPC, EKS 1.30, RDS Aurora, ElastiCache, S3, KMS |
| Vault deploy + auto-unseal | S1 | Vault Enterprise on EKS; audit backend to S3 |
| GitHub Actions CI | S1 | Build, test, Trivy scan, Cosign sign, SBOM per PR |
| Postgres migrations tool | P2 | `sql/migrations/` structure + runner (see §sql plan) |
| WorkOS tenant + OIDC | P1 | Dev IdP provisioned; token exchange verified locally |
| Temporal Cloud namespace | P1 | Dev + prod namespaces; TLS certs in Vault |
| PM: partner shortlist | PM | 8 target design partners identified + first reach-out |

**Exit criteria:** `main` branch builds green in CI; `terraform plan` clean; `psql` connects with tenant JWT session vars applied.

**Risks this week:** Vault ops complexity — TL and S1 pair on unseal drill day 3.

---

## Week 2 — Tenancy + control plane skeleton

**Goal:** A signed-in user can hit `POST /v1/tests` and get a manifest row with RLS enforced. Workflow does nothing yet.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Tenancy migrations (orgs, workspaces, repos) | P2 | Migrations 0001–0002 applied; RLS smoke test |
| API — auth middleware + JWT → session vars | P1 | Every request sets `app.workspace_id`; contract test |
| API — `POST /v1/tests` (no workflow yet) | P1 | Persists manifest row, returns 202 |
| Temporal workflow scaffolding | P1 | `CoverageWorkflow` stub that logs input and returns `pending` |
| TaskManifest schema in TS | TL | Shared package `@ops/types` published to workspaces |
| CLI v0 (`test-agent add`) | F1 | Auth via WorkOS device flow; hits `/v1/tests`; polls status |
| Prompts folder scaffolding | A1 | See §prompts plan; committed but empty stubs OK |
| Observability baseline | S1 | OTel Collector deployed; `correlation_id` propagates end to end |

**Exit criteria:** demo — CLI submits a test request; manifest row visible in Postgres; workflow started in Temporal; OTel trace visible in Grafana.

**Decisions to close this week:**
- CLI language (locked: **`npx test-agent` shim**, Node — reuses existing tooling; Go binary deferred to Q3)
- Vault vs. AWS Secrets Manager (locked: **Vault**)

---

## Week 3 — Browser Pool + LLM Gateway

**Goal:** Explorer can drive a real browser and call the LLM Gateway. No RAG or code generation yet.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Browser Pool deployment | S1 | gVisor runtime class working on `browser` node pool; 5-replica dev pool |
| Egress Broker (Envoy sidecar) | S1 | Default-deny policy; per-manifest allowlist injected via env |
| Session lifecycle (Redis-backed) | S1 + P1 | LPOP / SET busy / release / TTL-expiry flow (see [seq §2](./Q1-SEQUENCE-DIAGRAMS.md)) |
| LLM Gateway service | A2 | `POST /v1/complete`; Anthropic primary; OpenAI fallback; cost meter; DLP scrub |
| `llm_calls` migration + write path | P2 | Migration 0004; every Gateway call persists a row |
| Budget check (pre-call) | A2 | Reads `budgets` row; 429 when over daily cap |
| ExplorerWorkflow stub | A1 | Reserves session, runs Stagehand `agent.execute()` with placeholder prompt |

**Exit criteria:** Explorer runs a real Stagehand session against `https://playwright.dev/` in a gVisor pod and returns action trace. LLM Gateway spans show cost + provider in Grafana.

**Risks:** gVisor + Chromium compatibility surprises. S1 has a **half-week buffer** built into the sprint — if blocked past Wednesday, escalate to TL.

---

## Week 4 — Coverage happy path (dogfood)

**Goal:** Full "add a test" flow works against the team's own dogfood Playwright repo. No partner traffic yet.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| GitHub App registration + install flow | F1 + P1 | App live in dev org; install webhook creates workspace |
| OnboardingWorkflow + RepoProfile extraction | A1 | Extracts locator style + POM style from dogfood repo |
| Migrations for `manifest_events`, `repo_profiles`, `memory_flows` | P2 | 0003, 0005 applied; RLS covered |
| GeneratorWorkflow — no RAG, single-shot | A1 | Prompt v0 emits `spec.ts` + `page.ts`; static-check passes |
| JudgeWorkflow — runs Playwright, checks assertions | A2 | Test-runner pod pattern (mirrors Browser Pod); AST assertion match |
| PRSubmissionWorkflow (idempotent) | P1 | Signed commit via installation token; PR opens as draft |
| CoverageWorkflow wiring — full path | TL + P1 | All child workflows chained; end-to-end trace visible |
| Load test harness (k6) | S1 | Baseline capacity: single test at 1 rps, 10 rps, 50 rps |

**Exit criteria (Phase 1 gate):**
- ✅ Dogfood test written end-to-end, PR opened, passes CI
- ✅ p95 `CoverageWorkflow` < 20 min on dogfood
- ✅ No cross-tenant leakage in RLS test suite
- ✅ On-call runbook v1 published
- ✅ Cost dashboard shows per-workspace $ spent

**End-of-phase review** — full team retro; decide which risks got worse.

---

## Week 5 — Partner 1 onboarding

**Goal:** First real design partner (friendly early adopter) has their repo onboarded and generates their first test.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Partner 1 install + onboarding | PM + F1 + A1 | RepoProfile extraction reviewed with partner; overrides captured in `test-agent.yaml` |
| Style-conformance heuristic v1 | A1 | Scores generated code against extracted profile (`getByRole` used where profile says so) |
| Better error surfaces in PR body | F1 | PR template renders escalation category with next steps |
| `test-agent explain` PR command | A1 | Fetches manifest + returns reasoning as a comment |
| Docs site (Docusaurus) live | F1 | `/docs/install`, `/docs/first-test`, `/docs/troubleshooting` |
| SLO alerts wired (Grafana) | S1 | Pager for p95 > 20 min, budget exhaustion, RLS anomaly |
| RepoProfile 2.0 — subdirectory conventions | A1 | Different rules for `tests/cart/` vs `tests/admin/` |

**Exit criteria:** partner 1 has 3+ tests merged from Coverage; no manual intervention needed after onboarding.

**Risks:** partner's repo style is too varied for extraction. Mitigation ready: escalate to `test-agent.yaml` manual override; PM books extra time with partner if needed.

---

## Week 6 — Eval harness

**Goal:** Every prompt change and every model version bump runs through the eval harness before merge. Owner is **A2** in Q1, transfers to QA infra team in Q2.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Eval corpus v1 (50 triples) | A2 + F1 + PM | 20 synthetic + 30 from partner 1 (with data-sharing agreement); anonymized fixtures |
| Eval runner service | A2 | Runs golden suite; publishes AST similarity + gate-pass metrics |
| Regression alert in CI | A2 | Blocks PR if any metric drops > 5pp from baseline |
| Prompt versioning (Q1 lite) | A1 + A2 | File hash in OTel span; git-based; commit message convention |
| Retry / backoff hardening | P1 | Idempotency keys on all activities; verified via chaos test |
| Feature flag service (LaunchDarkly / open-source) | S1 | `agent_platform_active` kill switch; per-workspace flags |

**Exit criteria (Phase 2 gate):**
- ✅ Partner 1 in steady operation (3+ tests / week merging)
- ✅ Eval harness catches a deliberate prompt regression in dry-run
- ✅ Kill switch drill: full drain in < 60s

---

## Week 7 — Partners 2 + 3

**Goal:** Onboard two more partners in parallel. First real diversity — different repo styles, different Playwright versions.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Partner 2 onboarding | PM + F1 + A1 | Fresh install; RepoProfile + tests |
| Partner 3 onboarding | PM + F1 + A1 | Same |
| RAG retrieval (pgvector) | P2 + A1 | Replace naive few-shot with vector similarity over test files |
| Concurrent workflow throughput | P1 + S1 | Load test 10 concurrent Coverage runs; identify bottlenecks |
| Cost per test dashboard | A2 | Per-partner and per-repo unit economics |
| Signed commits everywhere | S1 | `test-agent[bot]` GPG key in Vault; verified via GitHub API |
| Backup + restore drill | S1 | RDS PITR restore to point 12h ago; measure RTO |

**Exit criteria:** 3 partners live; RAG measurably beats single-shot on style conformance (target: +15pp).

**Risks:** Playwright version skew across partners. A1 owns compatibility matrix (1.44, 1.48, 1.52+) — dropped support explicitly documented.

---

## Week 8 — Founding SDET joins; onboarding polish

**Goal:** Founding SDET starts customer-facing sessions; their feedback drives onboarding fixes.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| SDET onboarding week | TL + PM + SDET | Full stack tour; SDET runs a partner onboarding themselves |
| `test-agent init` (repo-side config) | F1 + SDET | Interactive wizard that generates `test-agent.yaml` |
| Better PR explanations | A1 + SDET | Reasoning trace summarized in PR body; "why did it pick this locator?" |
| Style-conformance metric hardened | SDET + A1 | Real corpus of style violations; heuristic reviewed |
| Documentation refresh | F1 + SDET | Rewrite install doc from SDET's fresh POV |
| Slack Community / Discord | PM + F1 | Partner-only channel opens; async support |

**Exit criteria:** SDET can onboard a partner solo end-to-end.

---

## Week 9 — Partners 4 + 5; hardening

**Goal:** All 5 design partners live. System hardened for concurrent load.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Partners 4 + 5 onboarded | PM + F1 + SDET | Onboarding time from install → first PR < 24h |
| Chaos day 1 | S1 + TL | Kill random pods, Postgres failover, Temporal namespace outage — measure recovery |
| RLS test suite expansion | P2 | 30+ cross-tenant scenarios; runs on every PR |
| Cost circuit breaker refinement | A2 | Warn at 80% of daily budget; throttle to Haiku at 90% |
| Onboarding docs based on 5 partners | F1 + SDET | Common gotchas section; troubleshooting decision tree |
| GitHub App rate limit handling | P1 | Backoff + queue for `check_runs` and PR ops at scale |

**Exit criteria (Phase 3 gate):**
- ✅ 5 partners in production; combined 50+ tests generated
- ✅ Zero cross-tenant incidents; RLS suite green
- ✅ Chaos day passed with SLO intact
- ✅ Cost per test < $2.50 sustained

---

## Week 10 — Steady state + retros

**Goal:** Prove the system is boring. Fix accumulated tech debt.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Partner retro interviews | PM + SDET | 30-min per partner; anonymous summary to team |
| Tech debt week | All | Each eng picks their 2 top annoyances; PR review budget doubled |
| SLO report | S1 | 30-day rolling p50/p95/p99 for CoverageWorkflow, LLM Gateway, Browser Pool |
| Prompt refactoring based on real data | A1 + A2 | Data-driven prompt update using OTel + eval corpus |
| Escalation issue triage template | F1 + SDET | Auto-labeled issues in customer repos; template for on-call SDET |

**Exit criteria:** 30-day change failure rate < 5%; partner NPS baseline captured.

---

## Week 11 — Q2 kickoff prep

**Goal:** Design Q2 deliverables (Triage Agent, OPA policy, trust ladder rungs 2–3) with the team's real Q1 experience informing scope.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Q2 tech design doc — Triage | TL + A1 | Follows Q1 doc's format; heal classifications + refuse categories |
| OPA policy pack v1 (dry-run) | P1 + P2 | Trust-rung rules encoded; runs alongside hardcoded logic in Q1 for comparison |
| Vector memory upgrade design | P2 + A1 | Semantic recall for locators (not just files) |
| Partner expansion plan | PM | Waitlist to 20; qualification criteria |
| GA readiness gap analysis | TL + PM | What's between us and paying customers (Q2 targets) |
| Founder / exec review | TL + PM | Q1 outcomes vs. plan; go/no-go on Q2 team expansion |

**Exit criteria:** Q2 design doc reviewed by team; hiring plan for Q2 published (2 eng + 1 designer).

---

## Week 12 — Prompt & agent quality push

**Goal:** Push the top KPIs to Q1 targets before end-of-quarter reporting.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Prompt A/B on partner traffic | A1 + A2 | Shadow-mode test of new Generator prompt; eval + real-world compare |
| Merge-without-changes rate → 60% | A1 + SDET | Push toward the Q1 target metric |
| Time-to-PR p95 → 15 min | P1 + S1 | Profile the workflow; find the top 3 latency sinks |
| Data-partner data-sharing renewal | PM | Extend 90-day terms; capture case studies |
| Marketing landing page (private beta) | F1 + PM | Waitlist collection; still not public |

**Exit criteria:** north-star KPI trajectory locked in for Q1 wrap-up presentation.

---

## Week 13 — Q1 wrap + partner event

**Goal:** Report Q1, celebrate, transition into Q2.

| Track | Owner | Deliverable |
|-------|-------|-------------|
| Q1 outcome report | PM + TL | Metrics vs. targets; wins; misses; learnings |
| Partner appreciation event (virtual) | PM + F1 | Sneak preview of Triage; extract testimonials for future launch |
| Runbook refresh | S1 + SDET | Every playbook reviewed post-Q1 experience |
| Q2 sprint 1 planning | All | First two Q2 sprints planned; tickets in tracker |
| Debt paydown backlog | TL | Prioritized list carried into Q2 |

**Exit criteria (Ship gate):**
- ✅ 5 design partners active
- ✅ 100+ tests generated across all partners
- ✅ Zero cross-tenant data incidents
- ✅ p95 CoverageWorkflow < 20 min (Q1 target)
- ✅ Merge-without-changes rate ≥ 60% (Q1 target)
- ✅ Q2 design doc + team plan approved

---

## Burndown & risk tracking

Weekly review, every Monday 30 min. Tracked in shared doc:

| Metric | Baseline | W4 | W6 | W9 | W13 target |
|--------|----------|----|----|----|----|
| Tests generated | 0 | 10 | 25 | 60 | 100 |
| Design partners live | 0 | 0 | 1 | 3 | 5 |
| p95 CoverageWorkflow | — | 25m | 22m | 20m | 20m |
| Merge-without-changes | — | 35% | 45% | 55% | 60% |
| Cost per test ($) | — | 4.00 | 3.00 | 2.50 | 2.00 |
| RLS test suite pass rate | — | 100% | 100% | 100% | 100% |
| Chaos day success | — | — | — | ✓ | — |

---

## Standing rituals

| Cadence | Ritual | Duration | Owner |
|---------|--------|----------|-------|
| Daily | Standup (async in Slack) | 5 min written | All eng |
| Mon | Weekly burndown review | 30 min | PM |
| Wed | Architecture / design review | 60 min | TL |
| Fri | Partner check-in call (with any active partner) | 30 min per | PM + SDET |
| End-of-week | Deploy freeze Fri after 3pm | — | S1 |
| Bi-weekly | Retro | 45 min | PM |
| End-of-phase | Phase review (W4, W6, W9, W13) | 90 min | All |

**Hard rules:**
- No prompt or model bump without eval harness pass
- No deploy to prod on Fridays after 3pm ET
- No feature merge without SLO impact reviewed
- Any partner incident → immediate cross-team huddle within 30 min

---

## Hiring plan (parallel to Q1)

| Role | Start | Sourcing owner |
|------|-------|----------------|
| Founding SDET | Week 8 | PM (started week 1) |
| Agent Eng 3 (Q2 start) | Week 13 | TL |
| Designer (Q2 start) | Week 13 | F1 |
| Support engineer (Q3) | Q2 mid | PM |

---

## What could kill Q1 (and mitigations)

| Risk | Kills Q1 if… | Mitigation |
|------|-------------|-----------|
| RepoProfile extraction unreliable | > 50% of generated tests are rejected in review | `test-agent.yaml` override; escalate to A1 pair with partner |
| gVisor + Chromium blocks | Browser Pool can't scale | Fallback to Kata Containers designed by W3 |
| Cross-tenant leakage bug | Any incident | Weekly RLS chaos test starting W4; deny-list in code review |
| Partner disengagement | 3+ partners go silent | White-glove weekly calls; PM owns retention |
| LLM cost overrun | Cost per test > $5 sustained | Circuit-breaker to Haiku; prompt shrinkage sprint |
| Temporal outage | Multi-hour incident | Idempotent activities enable full retry; separate DR runbook |

---

**End of Q1 Week-by-Week Plan.**
