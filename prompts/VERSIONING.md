# Prompt versioning + rollout procedure

## Golden rule

**Never edit a prompt in-place.** Every change creates a new file (`system.v2.md`); the old one stays until the new one has proven itself in production.

## Full procedure

### 1. Propose

- Open a discussion issue: "Proposal: Generator system prompt v2"
- Include: hypothesis (what will improve), targeted metric, expected side effects
- Get lightweight ack from an agent-team eng before writing code

### 2. Author

- Copy `prompts/<role>/system.md` → `prompts/<role>/system.v2.md`
- Edit `system.v2.md`
- Bump `id` in front-matter (`generator.system.v2`)
- Bump `last_reviewed`

### 3. Eval

```bash
npm run eval -- --prompt prompts/generator/system.v2.md
```

The eval output looks like:

```
Corpus: 50 triples
Metrics vs. baseline (generator.system.v1):
  AST similarity        +2.1 pp  ✓
  Playwright gate pass  +0.0 pp  ✓
  Style conformance     +4.2 pp  ✓
  Cost per test         -$0.08   ✓
Regression check: PASS (no metric dropped > 5pp)
```

If any metric drops > 5pp: iterate on the prompt. Do not merge with regressions unless the trade-off is explicitly approved (rare — attach owner + reviewer signatures on the PR).

### 4. PR

Open a PR with:
- The new prompt file
- Eval report as PR body attachment
- **Behavior change description** in prose — what will be different for users?
- **Rollback plan** — one-line: "revert this PR + drop feature flag `generator_prompt_v2`"

CI runs eval again and blocks merge on regressions.

### 5. Feature-flag

Merge behind `prompts.generator.system.v2` flag:

```typescript
const promptId = flags.enabled('prompts.generator.system.v2', workspaceId)
  ? 'generator.system.v2'
  : 'generator.system.v1';
```

Never merge a prompt change without a flag.

### 6. Canary

- 24 hours at 10% traffic — watch:
  - `merge_without_changes_rate` per prompt version
  - `cost_per_test_usd` per prompt version
  - error rate + escalation rate
- 24 hours at 50%
- 100% when both prior windows are ≥ baseline

Grafana dashboard `prompt-canary` compares v1 vs. v2 in real time.

### 7. Retire

Once v2 has been at 100% for 7 days with metrics ≥ baseline:
- Delete `system.md` (v1)
- Rename `system.v2.md` → `system.md`
- Remove the feature flag
- Bump `id` back to `generator.system.v1` in the file… **no** — keep the version number strictly monotonic. `id` stays `generator.system.v2` forever; the next iteration is `v3`.

### 8. Audit

Because every LLM call attaches `prompt.file` + `prompt.hash` to its OTel span, you can always answer:

> "Which prompt version produced this PR?"

by running:

```
correlation_id: <from PR comment>
  → span: llm.complete
    → attributes: { prompt.file: "generator.system.v2", prompt.hash: "sha256:..." }
```

## When to skip canary

Two cases only:

1. **Security fix** — a prompt is leaking data or bypassing DLP. Skip canary; deploy immediately; retroactively review.
2. **Cost circuit** — a prompt is causing runaway spend. Roll back immediately; investigate under a manifest post-mortem.

Both require a written post-mortem within 48 hours.

## Anti-patterns

- ❌ Editing a prompt in place because "it's just a small typo"
- ❌ Merging without an eval report
- ❌ Skipping the feature flag "for speed"
- ❌ Adding customer names, real URLs, or example credentials to prompts
- ❌ Making the prompt reference a specific model version in prose (delegate that to task-class routing)
- ❌ Deploying multiple prompt changes in the same PR — you can't attribute regressions

## Emergency rollback

```bash
# Flip the flag
launchdarkly-cli disable prompts.generator.system.v2

# Verify
curl https://api.test-agent/v1/debug/prompt?role=generator | jq
# Should return id: "generator.system.v1"
```

If the flag service itself is down, the deploy of choice is a single-line PR reverting the workflow code to hard-select v1.
