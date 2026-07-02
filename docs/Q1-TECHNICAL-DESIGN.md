# Q1 Technical Design: Foundation + Coverage MVP

> ### ⚠ Scope note — v0 is local-first
>
> **v0 (current):** the whole platform runs on a laptop against Docker Postgres, a real Playwright repo, and real LLM APIs. No AWS, no Temporal Cloud, no WorkOS, no Vault. See [../README.md](../README.md) for the local quick-start.
>
> **v1 (this document, "future"):** the SaaS shape below is where we take the platform once local end-to-end is proven. Sections marked *"Future — v1"* are parked (Terraform lives in [`infra/future/`](../infra/future/)).
>
> **What survives the transition unchanged:** SQL schema + RLS, Task Manifest contract, prompts, memory schema, worker activity boundaries. Every cloud piece has a local swap behind an interface (`ArtifactStore`, `AuthProvider`, `WorkflowQueue`), so the v1 lift is component replacement, not a rewrite.
>
> Read this doc as the destination. Read [../README.md](../README.md) for what runs today.

---

**Status:** DRAFT · **Owner:** [tech lead] · **Reviewers:** platform, agent, infra, security
**Timeline:** Weeks 1–13 (v1 target)
**Ship gate:** 5 design partners running Coverage Agent in production; 100 tests generated end-to-end; zero cross-tenant data incidents.

---

## 1. Context

Q1 delivers the **Coverage MVP** on a multi-tenant SaaS baseline. This is a subset of the full production architecture; everything not listed here is explicitly deferred.

### In scope for Q1
- Multi-tenant baseline: auth, tenancy, Postgres RLS, encryption at rest, audit log
- Durable control plane on Temporal Cloud
- Task Manifest schema + lifecycle
- Coverage Agent — "add a new test from a description + URL"
- Repo Onboarding — detect Playwright config, style conventions, fixtures
- Sandboxed browser pool — Chromium in gVisor, egress-controlled
- LLM Gateway — Claude Sonnet 4.6 primary, GPT-4o fallback, cost meter
- GitHub App — webhooks + PR-write flow
- OTel observability — traces, metrics, logs; Grafana Cloud dashboards
- Design-partner alpha with 5 tenants

### Deferred (later quarters)
- Triage Agent (heal failing tests) — Q2
- Steward Agent (flake detection, drift, weekly reports) — Q3
- Vector semantic recall — Q2 (pgvector installed in Q1, unused)
- OPA policy engine — Q2 (Q1 hardcodes rung-1 behavior)
- Multi-region — Q4
- Slack App — Q2
- Web dashboard — Q3 (Q1 uses CLI + PR comments)
- Trust ladder rungs 2–5 — Q2
- SOC2 Type I audit — Q3

---

## 2. Goals

- **G1** — A QA lead installs the GitHub App, connects a repo, and describes a new test via CLI. Within 10 minutes they receive a PR with the generated test.
- **G2** — Generated tests use the team's locator conventions, POM style, and fixtures — recognizable code, not "generated slop."
- **G3** — 60%+ of PRs merge without code changes from design partners.
- **G4** — Multi-tenant boundary is hard: no tenant can read another tenant's data, prompts, or artifacts, even with an app-layer bug.
- **G5** — Every action is auditable end-to-end from GitHub webhook → PR merge via a single correlation ID.

## 3. Non-goals for Q1
- Healing failing tests (Triage)
- Proactive / autonomous test creation (agent must be user-invoked)
- Streaming UI to a dashboard
- BYOK LLM (all traffic through our gateway)
- Marketplace listing, free tier
- Non-GitHub Git hosts

---

## 4. High-level architecture (Q1 subset)

```
    [Developer CLI]
          │  POST /v1/tests
          ▼
    [Public API]  ──── mTLS ────►  [Temporal Cloud]
          │                              │
          │                              ▼
          │                      [CoverageWorkflow]
          │                              │
          │        ┌─────────────────────┼─────────────────────┐
          │        ▼                     ▼                     ▼
          │  [ExplorerWorkflow]  [GeneratorWorkflow]    [JudgeWorkflow]
          │        │                     │                     │
          │        ▼                     ▼                     ▼
          │  [Browser Pool]       [LLM Gateway]        [Test Runner Pool]
          │  gVisor + egress                             Playwright
          │        │                     │                     │
          │        └─────────────────────┼─────────────────────┘
          │                              ▼
          │                        [GitHub App]  ──► PR
          ▼
    [Postgres RLS] · [Redis] · [S3+ObjectLock] · [Vault] · [OTel → Grafana]
```

Single K8s cluster in `us-east-1`, multi-AZ, three node pools (control / worker / browser). Multi-region deferred to Q4.

---

## 5. Component designs

### 5.1 Multi-tenant baseline

**Identity provider:** WorkOS — SSO + SCIM for enterprise, single vendor for auth from day one.

**Tenancy model:**
```
Organization  (1 per contract)
    └── Workspace  (dev / staging / prod isolation per team)
            └── Repository  (a Playwright repo installation)
```

Every request carries `(orgId, workspaceId, repoId?)` in the JWT. Middleware sets Postgres session variables on the pooled connection before the first query:

```typescript
await client.query(`SET LOCAL app.org_id = $1`, [ctx.orgId]);
await client.query(`SET LOCAL app.workspace_id = $1`, [ctx.workspaceId]);
```

RLS policies (see §12.2) enforce isolation. **No `service_role` shortcuts**; internal jobs run with an explicit workspace context or system context that is separately audited.

**Audit log:** append-only Postgres table, streamed nightly to S3 with Object Lock (WORM, 7-year retention). Every action emits `(correlationId, actor, resource, action, outcome)`.

### 5.2 Task Manifest

The contract every agent honors. See §12.1 for the full TypeScript.

**Lifecycle state machine:**
```
pending ─► assigned ─► in_progress ─┬─► succeeded
                                    ├─► failed
                                    ├─► rejected  (agent refused per policy)
                                    └─► cancelled (human / SLA breach)
```

Storage: the **Temporal workflowId is source of truth**; Postgres is a queryable projection updated via event-sourced `manifest_events`.

### 5.3 Control plane — Temporal

**Provider:** Temporal Cloud (defer self-host indefinitely; not a differentiator).

| Workflow | Purpose | Timeout |
|----------|---------|---------|
| `OrchestratorWorkflow` | Long-lived per tenant; routes signals to specialists | ∞ |
| `CoverageWorkflow` | One per "add a test" request | 30 min |
| `ExplorerWorkflow` | Drives browser to complete the goal | 15 min |
| `GeneratorWorkflow` | RAG + LLM emits code | 5 min |
| `JudgeWorkflow` | Runs Playwright, verifies outcomes | 10 min |
| `PRSubmissionWorkflow` | Creates branch + PR | 3 min |
| `OnboardingWorkflow` | Repo profile extraction on install | 10 min |

**Activities** (idempotent, retryable):
`probeTarget`, `startBrowserSession`, `executeAgentGoal`, `captureAriaSnapshot`, `readRepoFiles`, `ragSelectExamples`, `callLLM`, `writeTestFile`, `runPlaywright`, `openPR`, `emitAuditEvent`.

Default retry policy: `max=3, backoff=exponential(1s, 30s), non-retryable=[PolicyViolation, InvalidInput, BudgetExceeded]`.

Signals: `cancel`, `humanApproval`, `pause`.

### 5.4 Coverage workflow — pseudocode

```typescript
export async function CoverageWorkflow(input: CoverageInput): Promise<CoverageOutput> {
  const manifest = await activity.createManifest(input);
  await activity.enforcePolicy(manifest, { rung: 1 });

  const probe = await activity.probeTarget(input.url);
  if (!probe.ok) return reject(manifest, 'target_unreachable', probe);

  const profile = await activity.loadRepoProfile(input.repoRef);
  if (!profile) return reject(manifest, 'repo_not_onboarded');

  const exploration = await workflow.executeChild(ExplorerWorkflow, {
    args: [{ manifestId: manifest.id, url: input.url, goal: input.goal,
             expectedOutcomes: input.expectedOutcomes }],
  });
  if (!exploration.verified) {
    return reject(manifest, 'outcomes_not_verified', exploration);
  }

  const generation = await workflow.executeChild(GeneratorWorkflow, {
    args: [{ manifestId: manifest.id, profile, exploration, goal: input.goal }],
  });

  const judgment = await workflow.executeChild(JudgeWorkflow, {
    args: [{ manifestId: manifest.id, testPath: generation.testPath,
             pageObjectPath: generation.pageObjectPath,
             expectedOutcomes: input.expectedOutcomes }],
  });
  if (!judgment.passed) {
    // Q1: no heal loop. Escalate.
    return escalate(manifest, 'test_did_not_pass', judgment);
  }

  const pr = await activity.openPR({
    repoRef: input.repoRef,
    branch: `test-agent/${manifest.id.slice(0, 8)}`,
    title: `Add test: ${input.goal.slice(0, 60)}`,
    body: renderPRBody(manifest, exploration, generation, judgment),
    files: [generation.testPath, generation.pageObjectPath],
  });

  return { status: 'succeeded', prUrl: pr.url, manifestId: manifest.id };
}
```

**Q1 is explicit: no self-healing.** If Judge fails, we escalate with full artifacts. Adding the heal loop is Q2's Triage work.

### 5.5 Worker agents (Temporal activities)

**Explorer** — thin wrapper on Stagehand. Existing POC code in [`packages/agent-server/src/worker.ts`](../packages/agent-server/src/worker.ts) is the seed; refactor to strip the fixed pipeline and expose as a pure activity.

- Input: `{ url, goal, expectedOutcomes, sessionOptions }`
- Output: `{ actions[], ariaSnapshot, verified, tracePath, videoPath, screenshots[] }`
- Verified = every `expectedOutcome` appears in the final page's a11y tree (guardrail from [`agent-quality.ts`](../packages/agent-server/src/agent-quality.ts))

**Generator** — RAG + LLM.
1. Query pgvector for k=3 tests most similar to `goal` (embedding of goal + repo profile summary)
2. `readRepoFiles` for the picked tests + their page objects + shared fixtures
3. Compose system prompt from `RepoProfile` (see §5.6): "team uses `getByRole` for buttons and `data-testid` for cart items"
4. User prompt: goal + observed action trace + expected outcomes + few-shot examples
5. `callLLM` via gateway → `{ testCode, pageObjectCode }`
6. Static-check: TypeScript compiles; `playwright test --list` includes the new test
7. Reject and retry once with error output if either check fails
8. Return relative paths

**Judge** — sandboxed test runner.
- `runPlaywright` executes the test in a Firecracker microVM (Q1: K8s pod with gVisor; Firecracker in Q3)
- Passing exit code alone is insufficient. Judge also AST-checks that each `expectedOutcome` has a matching assertion (regex on the file)
- Output: `{ passed, exitCode, tracePath, videoPath, matchedOutcomes[] }`

### 5.6 Repo Onboarding + RepoProfile

The differentiator. Without it we ship generic-looking tests and get rejected in review.

**Trigger:** GitHub App `installation_repositories.added`.

**Extraction pipeline** (`OnboardingWorkflow`):
1. Shallow clone repo into ephemeral pod, read-only mount
2. Parse `playwright.config.ts` → base URL, test dir, projects
3. Enumerate tests via `playwright test --list --reporter json`
4. Parse fixtures — grep for `test.extend`, `test.use`, `global-setup`
5. Sample 20 representative tests, run each through a lightweight LLM classifier (Haiku) that extracts:
   - Locator style per subdirectory (`getByRole` | `getByLabel` | `getByPlaceholder` | `getByTestId` | `locator(css)`)
   - Assertion style (soft assertions? custom matchers? `expect.poll`?)
   - Import patterns (`@playwright/test` alone vs. custom `test` re-export)
   - Naming (`kebab-case` vs `camelCase` filenames)
6. Detect auth flow (`storageState` path, `global-setup.ts` presence)
7. Persist as `repo_profiles` row + write embedding to pgvector

**Output for user:** GitHub Issue titled "Test Agent onboarding report — please review" with the extracted profile as YAML. User confirms → workspace flips to `active`.

**Overrides:** users can commit `test-agent.yaml` at repo root to force conventions. This file takes precedence over extraction.

### 5.7 Browser Pool

**Runtime:** K8s `Deployment`, runtime class `gvisor` (via `runsc`), Playwright 1.52 + Chromium.

**Sizing (Q1):**
- Baseline 20 replicas; HPA to 60 on `queue_depth > 5` for 30s
- Per pod: 2 vCPU, 4 GiB RAM, warm pool of 5 pre-spawned Chromium instances

**Session lifecycle:**
1. Explorer activity calls `startBrowserSession(manifestId)` → LPOP from Redis `pool:idle`
2. Session assigned; TTL 15 min tracked via Redis `SET pool:busy:{sid} EX 900`
3. On completion: session destroyed (never reused across tenants)
4. On timeout: Redis notifies pod; pod deletes session and restarts (fresh state)

**Isolation guarantees:**
- gVisor blocks kernel escape
- K8s NetworkPolicy: browser pods can only reach the Egress Broker sidecar
- Filesystem: read-only root; `emptyDir` for `/tmp` and Chromium profile
- No persistent state; pod restart wipes everything

**Egress Broker:** Envoy sidecar. Per-manifest allowlist derived from the target URL host + its declared subresource hosts (populated during onboarding). Default deny. Every outbound request logged with `(manifestId, host, path, status)`.

### 5.8 LLM Gateway

Standalone service. All agent activities call `POST /v1/complete` — **never `api.anthropic.com` directly**.

**Providers (Q1):**
| Provider | Models |
|----------|--------|
| Anthropic | `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` |
| OpenAI | `gpt-4o` |

**Task-class routing:**
| Task class | Primary | Fallback |
|------------|---------|----------|
| `plan` (Orchestrator, Coverage plan) | Sonnet 4.6 | GPT-4o |
| `generate` (test code) | Sonnet 4.6 | GPT-4o |
| `classify` (small decisions, profile extraction) | Haiku 4.5 | Sonnet 4.6 |
| `verify` (Judge outcome match) | Haiku 4.5 | Sonnet 4.6 |

**Fallback logic:**
- HTTP 429 / 5xx from primary → immediate retry on fallback
- If primary p95 latency > 20s over trailing 5 min → shift 10% traffic to fallback
- Manual override via `llm_provider_override` feature flag

**Cost meter:** every call increments Redis counters `cost:{workspaceId}:{yyyy-mm-dd}:{provider}:{model}` and Postgres `llm_calls`. **Hard pre-call cap:** if today's cost > tenant's daily budget, `429 BudgetExceeded` — activity fails with non-retryable error, workflow escalates.

**PII redaction:** pre-send scrubber strips credit cards, SSNs, emails, and tenant-specific regex from prompt bodies. Redacted values replaced with `<REDACTED:type>`. Prompts are logged **post-redaction** only.

**Prompt versioning (Q1 lite):** every prompt is a versioned file in `prompts/` (Git). Prompt registry service (Q2) will formalize; for Q1, file hash embedded in the OTel span.

### 5.9 GitHub App

**Permissions requested:**
- Repository contents: read + write
- Pull requests: read + write
- Checks: read + write
- Metadata: read
- Webhook events: `push`, `pull_request`, `check_run`, `installation`, `installation_repositories`

**Installation flow:**
1. User installs App on org, selects repos
2. Backend receives `installation.created` → creates `Workspace` + `Repository` rows
3. Starts `OnboardingWorkflow` for each repo
4. Posts profile report to a new "Test Agent Setup" issue
5. User approves → workspace `status: active`

**PR submission flow:**
1. `openPR` activity acquires installation token from Vault (short-lived, per repo)
2. Creates branch `test-agent/<manifest-id-short>`
3. Commits generated files (`Author: test-agent[bot]`, signed commit)
4. Opens PR with body template (§7.3)
5. Attaches a `check_run` linking to trace artifact
6. Posts a summary comment

### 5.10 Observability

**Spans:** every workflow, activity, LLM call, browser action, GitHub API call. Attributes:
- `manifest.id`, `manifest.role`, `manifest.trust_rung`
- `tenant.workspace_id` (hashed for cross-tenant queries)
- `llm.provider`, `llm.model`, `llm.tokens_input`, `llm.tokens_output`, `llm.cost_usd`
- `github.repo`, `github.pr_url`
- `outcome`, `error.code`

**Correlation:** `correlation_id` (UUID) generated on webhook receipt, propagated as OTel baggage through every child workflow and activity.

**Backend:** OTel Collector → Grafana Cloud (traces) + Loki (logs) + Prometheus (metrics).

**Dashboards (v1):**
- Manifest lifecycle: rate, latency, outcomes, per workspace
- LLM cost: per workspace, per model, per task class
- Browser pool: queue depth, session duration, utilization
- Error rate: per activity, per workspace
- SLO burn: p50 / p95 for `CoverageWorkflow` end-to-end

---

## 6. Data model (Postgres)

Core tables — full DDL in §12.2:
```
organizations       (id, name, plan)
workspaces          (id, org_id, name, github_installation_id, status)
repositories        (id, workspace_id, full_name, default_branch, profile_id, status)
repo_profiles       (id, repo_id, conventions_json, extracted_at)
manifests           (id, workspace_id, role, status, goal, budget, policy, audit, workflow_id)
manifest_events     (id, manifest_id, ts, kind, payload)
memory_flows        (id, repo_id, goal_hash, locators, actions, success_count, updated_at)
llm_calls           (id, manifest_id, provider, model, tokens_in, tokens_out, cost_usd, latency_ms, ts)
audit_log           (id, org_id, actor, action, resource, outcome, correlation_id, ts)
budgets             (workspace_id, daily_usd, monthly_usd, current_day_usd, current_month_usd)
```

All tenant-scoped tables carry `workspace_id` and have RLS.

---

## 7. API contracts

### 7.1 Public API v1

```
POST   /v1/tests             Create a Coverage manifest
GET    /v1/tests/:id         Get manifest status
POST   /v1/tests/:id/cancel  Cancel a manifest
GET    /v1/repos             List onboarded repos
POST   /v1/repos/:id/onboard Trigger repo profile extraction
GET    /v1/health            Liveness
```

`POST /v1/tests` request:
```json
{
  "repoId": "repo_01H...",
  "goal": "As a shopper, I can add 3 items to cart and see the cart total match the item prices",
  "targetUrl": "https://staging.example.com/products",
  "credentialsRef": "vault://tenants/acme/staging-user",
  "expectedOutcomes": [
    "cart badge shows 3",
    "cart total equals sum of item prices"
  ]
}
```
Response: `202 Accepted { manifestId, workflowId, correlationId }`.

### 7.2 Internal RPC
- API ↔ Temporal: workflow client (mTLS)
- Workers ↔ LLM Gateway: HTTP+JSON over mTLS
- Workers ↔ Browser Pool: Redis for reservation, HTTP for control
- Workers ↔ GitHub: GitHub REST via `@octokit`

### 7.3 PR body template
```markdown
## Test generated by Test Agent

**Manifest:** `{{manifest_id}}` · **Trust rung:** 1 (draft, review before merge)

### Goal
> {{goal}}

### Expected outcomes (verified on screen)
- [x] {{outcome_1}}
- [x] {{outcome_2}}

### How this test was built
1. Explored `{{target_url}}` in a sandboxed browser
2. Verified each outcome via a11y tree
3. Selected `{{example_1}}.spec.ts` and `{{example_2}}.spec.ts` as style references
4. Generated `{{test_path}}` + `{{page_object_path}}`
5. Passed locally: `npx playwright test {{test_path}}`

### Artifacts
- [Playwright trace]({{trace_url}}) · [Video]({{video_url}}) · [a11y snapshot]({{aria_url}})

### If this is wrong
Comment `@test-agent revert` and this PR will be closed.
Comment `@test-agent explain` for the reasoning trace.
```

---

## 8. Sequence — "Add a test" end to end

1. User runs `test-agent add "…" --url https://… --repo acme/shop`
2. CLI calls `POST /v1/tests` → API validates auth, RLS, budget → returns `202`
3. API starts `CoverageWorkflow` on Temporal Cloud
4. Workflow creates manifest row (`status=pending`) → emits `manifest.created` audit event
5. Workflow calls `probeTarget`, `loadRepoProfile`
6. Workflow starts child `ExplorerWorkflow`:
   1. Reserve browser session (Redis LPOP `pool:idle`)
   2. Run Stagehand `agent.execute()` with system prompt built from repo profile
   3. Verify expected outcomes on final a11y tree
   4. Upload trace + video to S3 with signed URL, TTL 30 days
   5. Return `{ actions, ariaSnapshot, verified: true, tracePath }`
7. Workflow starts child `GeneratorWorkflow`:
   1. `ragSelectExamples(repoRef, goal, k=3)` → similar test paths
   2. `readRepoFiles` fetches examples + fixtures + POM base
   3. `callLLM` (Sonnet 4.6) → `{ testCode, pageObjectCode }`
   4. Static-check via `writeTestFile` + `playwright test --list`
   5. Return relative paths
8. Workflow starts child `JudgeWorkflow`:
   1. `runPlaywright` on the new test file in a runner pod
   2. AST-check for assertions matching expected outcomes
   3. Return `{ passed: true, tracePath }`
9. Workflow calls `openPR` — commits files, opens PR, attaches check run
10. `manifests.status = succeeded`; final audit event emitted
11. User receives GitHub notification of new PR

---

## 9. Deployment topology

**Region:** `us-east-1`. Multi-region deferred to Q4.

**Cluster:** EKS 1.30. Three node pools:
- `control` — `m6i.xlarge` × 3–6 — API, Temporal workers, GitHub App service
- `worker` — `m6i.2xlarge` × 5–15 (HPA) — LLM Gateway, activity workers, Onboarding worker
- `browser` — `c6i.2xlarge` × 5–30 (HPA + gVisor runtime class) — browser pods + Playwright runner pods

**Networking:** Istio for mTLS + strict network policies. Egress Broker as sidecar on browser and runner pods.

**Data:**
- RDS Aurora Postgres 16, multi-AZ, PITR enabled, 30-day retention
- ElastiCache Redis 7 (2-node cluster mode)
- S3 for artifacts (traces, videos, snapshots); Object Lock for `audit_log` exports
- Temporal Cloud (managed)
- Vector store: pgvector on same Aurora — no Pinecone in Q1

**Secrets:** HashiCorp Vault Enterprise (auto-unseal via AWS KMS, full audit).

**CI/CD:** GitHub Actions for build + test + SBOM + Trivy scan; Argo CD for GitOps deploys. Cosign-signed images required.

**IaC:** Terraform for AWS; Helm charts for services; Argo CD ApplicationSets for dev/stage/prod.

---

## 10. Testing strategy

| Layer | Approach |
|-------|----------|
| Unit | Jest, per module. 80% target for control-plane services, 60% for agents |
| Contract | Pact between API ↔ workers; Temporal workflow replay tests |
| Integration | Docker Compose stack: Postgres + Redis + LocalStack + Temporal dev server + mock LLM |
| Eval | Golden suite of 50 (goal, repo, expected PR) tuples on every prompt-registry change |
| End-to-end | Nightly against dogfood repo |
| Load | k6 hitting `POST /v1/tests` at 10 rps sustained |
| Security | Semgrep + Trivy in CI; annual pen test |

**Eval harness — Q1 must-have:**
- Corpus: 50 real / realistic (goal, repo, expected PR) triples with human-reviewed golden PRs
- Metrics: AST similarity to golden, `playwright test --list` gate pass rate, style conformance (heuristic)
- Baseline captured at launch; alert on regression > 5 percentage points
- Runs on every prompt change and every model version bump

---

## 11. Rollout plan

- **Weeks 1–4** — internal alpha on team's own Playwright repo
- **Weeks 5–6** — first design partner (friendly early adopter, white-glove)
- **Weeks 7–9** — 2–3 partners onboarded
- **Weeks 10–13** — 4–5 partners; steady-state; Q2 kickoff planning

**Feature flags:**
- `coverage_agent_enabled` (per workspace)
- `pr_auto_open` — start as **draft only**
- `browser_pool_size` (per env)
- `llm_provider_override` (debugging)

**Kill switch:** single flag `agent_platform_active` disables all workflow starts and drains in-flight. Tested weekly.

**Per-partner "done":**
- 5+ successfully generated + merged tests
- Zero cross-tenant data incidents
- SLO met (p95 < 20 min)
- User satisfaction ≥ 4/5

---

## 12. Appendices

### 12.1 TaskManifest — TypeScript

```typescript
export interface TaskManifest {
  id: string;
  workspaceId: string;
  orgId: string;
  parentManifestId?: string;
  workflowId: string;
  createdAt: string;
  createdBy: 'human' | 'orchestrator' | 'specialist';

  role: ManifestRole;
  status: ManifestStatus;
  goal: ManifestGoal;
  context: ManifestContext;
  budget: ManifestBudget;
  successGate: ManifestSuccessGate;
  policy: ManifestPolicy;
  audit: ManifestAudit;
}

export type ManifestRole =
  | 'orchestrator' | 'coverage' | 'triage' | 'steward'
  | 'explorer' | 'generator' | 'healer' | 'reviewer' | 'judge';

export type ManifestStatus =
  | 'pending' | 'assigned' | 'in_progress'
  | 'succeeded' | 'failed' | 'rejected' | 'cancelled';

export interface ManifestGoal {
  kind: 'add_test' | 'onboard_repo' | 'explore_flow' | 'generate_code' | 'judge_test';
  description: string;
  params: Record<string, unknown>;
}

export interface ManifestContext {
  repoRef?: { fullName: string; sha?: string };
  memoryRefs: string[];
  priorManifests: string[];
}

export interface ManifestBudget {
  maxTokens: number;
  maxSteps: number;
  maxDurationSec: number;
  maxCostUSD: number;
}

export interface ManifestSuccessGate {
  verifier: ManifestRole;
  criteria: string[];
}

export interface ManifestPolicy {
  trustRung: 1 | 2 | 3 | 4 | 5;
  canWritePR: boolean;
  canFileIssue: boolean;
  refuseCategories: string[];
  escalationSLA: number;
}

export interface ManifestAudit {
  correlationId: string;
  signalId?: string;
}
```

### 12.2 Postgres DDL (excerpts)

```sql
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'design_partner',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organizations(id),
  name                    TEXT NOT NULL,
  github_installation_id  BIGINT,
  status                  TEXT NOT NULL DEFAULT 'pending',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE manifests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL,
  workspace_id        UUID NOT NULL REFERENCES workspaces(id),
  parent_manifest_id  UUID REFERENCES manifests(id),
  role                TEXT NOT NULL,
  status              TEXT NOT NULL,
  workflow_id         TEXT NOT NULL,
  goal                JSONB NOT NULL,
  budget              JSONB NOT NULL,
  policy              JSONB NOT NULL,
  audit               JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON manifests (workspace_id, status);
CREATE INDEX ON manifests ((audit->>'correlationId'));

ALTER TABLE manifests ENABLE ROW LEVEL SECURITY;
CREATE POLICY manifests_rls ON manifests
  USING (workspace_id = current_setting('app.workspace_id')::uuid);

CREATE TABLE llm_calls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  manifest_id  UUID NOT NULL REFERENCES manifests(id),
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  task_class   TEXT NOT NULL,
  tokens_in    INTEGER NOT NULL,
  tokens_out   INTEGER NOT NULL,
  cost_usd     NUMERIC(10, 6) NOT NULL,
  latency_ms   INTEGER NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON llm_calls (workspace_id, ts);
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY llm_calls_rls ON llm_calls
  USING (workspace_id = current_setting('app.workspace_id')::uuid);

CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  org_id          UUID NOT NULL,
  workspace_id    UUID,
  actor           TEXT NOT NULL,
  action          TEXT NOT NULL,
  resource        TEXT NOT NULL,
  outcome         JSONB NOT NULL,
  correlation_id  UUID NOT NULL,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (org_id, ts);
CREATE INDEX ON audit_log (correlation_id);
-- Nightly export to S3 with Object Lock
```

### 12.3 Q1 cost model (rough)

Assumptions: 5 design partners × 20 tests / partner / month; ~$1.50 LLM + $0.20 compute per generated test.

| Line | Monthly (Q1) |
|------|--------------|
| Temporal Cloud | $500 |
| AWS EKS + RDS + Redis + S3 | $3,500 |
| LLM (Anthropic + OpenAI) | $150 |
| Grafana Cloud | $400 |
| WorkOS + Vault | $600 |
| **Total** | **~$5,200/mo** |

Heavily under-utilized at Q1 volume; still under-budget for the value delivered.

### 12.4 Vendor decisions (locked for Q1)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Auth | WorkOS | Enterprise SSO + SCIM out of the box |
| Durable workflows | Temporal Cloud | Managed; ops burden acceptable |
| LLM primary | Anthropic Claude Sonnet 4.6 | Best TypeScript code quality |
| LLM fallback | OpenAI GPT-4o | Broadest provider hedge |
| Vector store | pgvector | One fewer system in Q1 |
| Sandboxing | gVisor + Egress Broker | Google-maintained, K8s-native |
| Secrets | HashiCorp Vault Enterprise | Auto-unseal + full audit |
| Observability | Grafana Cloud + OTel Collector | Best price/features at Q1 scale |
| CI/CD | GitHub Actions + Argo CD | Familiar; SLSA L2 path clear |

---

## 13. Risks + open questions (Q1-specific)

**Risks**
1. **Repo convention extractor accuracy.** If style detection misses, tests get rejected in review — the whole differentiator collapses. *Mitigation:* `test-agent.yaml` manual override; onboarding report as human gate.
2. **Temporal Cloud cold-start latency.** 500ms – 2s per new workflow; adds up per manifest. *Mitigation:* warm workers via periodic no-op signal.
3. **Browser pool bin-packing.** Chromium containers ~800 MiB each; underprovision → queue explosion. *Mitigation:* load test in week 4 before first partner.
4. **LLM output stability.** Provider silently rolls a model → prompts break overnight. *Mitigation:* pin exact model versions; eval harness catches drift.
5. **Cross-tenant leakage bug.** RLS misconfig or a `service_role` shortcut = existential incident. *Mitigation:* RLS test suite that runs every deploy; deny-list `service_role` in code review.

**Open questions to close by week 2**
- CLI shipped as single Go binary vs. `npx test-agent` shim?
- Owner of the eval harness — QA infra team or agent team?
- Design-partner data-sharing terms (needed for eval corpus)
- Vault vs. AWS Secrets Manager — Vault preferred, ops cost real
- Browser pool: same EKS cluster or a separate one (better isolation, more ops)?

---

*End of Q1 Technical Design.*
