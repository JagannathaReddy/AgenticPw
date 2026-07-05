# Running test-agent in CI — security & budget notes (#18)

The heal action (`.github/actions/heal`) boots the full stack on an ephemeral
runner and calls a paid LLM API. Four things to get right before wiring it up.

## 1. The LLM key

- Store it as a **repository or org secret** (`OPENAI_API_KEY`), never in the
  workflow file, never in `.env` committed anywhere.
- **Fork PRs must never see it.** GitHub already withholds secrets from
  `pull_request` runs of forks; keep it that way:
  - use the plain `pull_request` trigger (like
    [heal-on-failure.yml](../../.github/workflows/heal-on-failure.yml) does), and
    guard the job with
    `github.event.pull_request.head.repo.full_name == github.repository`;
  - **never** switch the trigger to `pull_request_target` to "make secrets
    work on forks" — that combination hands your key to arbitrary fork code.
- The key travels into the action via the `openai-api-key` input and only
  reaches the worker process env. It is never echoed, logged, or written to
  artifacts.

## 2. The budget

- The action's `max-cost` input (default **$2**) is a hard per-run cap
  enforced by the batch orchestrator: spend is summed from `llm_calls`
  before each child heal and the rest are marked `skipped_budget`.
- A typical heal costs ~$0.002 with gpt-4o-mini, so $2 ≈ headroom for
  hundreds of heals — tighten it if your specs are huge (prompt size scales
  with spec + page-object + helper sources).
- `agent cost --since 7d` on any machine pointed at the same DB shows the
  ledger. In CI the DB is ephemeral, so treat the job-summary spend line as
  the record, or archive `.eval-report.json`-style artifacts if you need an
  audit trail.

## 3. Caches on shared runners

- The action sets `NO_CACHE=1`: the content-addressable snapshot + LLM
  cache (#20) is built for one trusted machine, and reusing cache entries
  across CI runs on shared runners risks cross-run bleed. Leave it off.
- If your runs get slow and your runners are self-hosted + single-tenant,
  you may wrap `local-artifacts/cache/` with `actions/cache` and drop
  `NO_CACHE` — do this only when the runner is yours.
- `npm` caching via `actions/setup-node` is fine — it's public packages.

## 4. What the action is allowed to do

- **Suggestions only by default (trust rung 1).** Every heal is dry-run;
  patches live in `local-artifacts/<id>/` on the runner and in the PR
  comment / artifact. The action never pushes to *your* branch, never
  auto-merges, and never fails your CI on refusals.
- **Trust rung 3 (`open-pr: 'true'`)** is the one write the action can do:
  verified patches are committed to a fresh `test-agent/heal-*` branch and
  opened as a PR — a human still reviews and merges. It requires an
  explicit `github-token` plus `contents: write` and `pull-requests:
  write`; without those inputs the step cannot run. Never grant this on
  fork-triggered runs.
- Rung 1 workflows need only `contents: read` plus `pull-requests: write`
  if you post the comment. No other permissions.
- The Postgres container is throwaway (default credentials, bound to the
  runner's localhost, destroyed with the runner). Do not point the action
  at a persistent shared database — RLS is real, but CI has no auth story
  yet (the dev tenant is hardcoded); that's the cloud v1 boundary.
