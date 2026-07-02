# Prompts

Versioned prompts for every LLM-driven role in the platform. **This directory is the source of truth** — nothing else may hard-code prompt strings inline in application code.

## Why this exists

Prompts are product code. Small wording changes cause large behavior changes. They deserve the same rigor as any other artifact that ships:

- **Versioned** in Git — every change is a reviewable PR
- **Hash-tracked** at runtime — every LLM call attaches `prompt.file`, `prompt.hash` to its OTel span
- **Eval-gated** — no prompt merges without passing the golden eval suite
- **Canary-rolled** — high-traffic prompts A/B ship at 10% → 50% → 100%

The Q1 registry is file-based (this folder). The Q2 **Prompt Registry service** formalizes canary rollout, per-tenant overrides, and rollback. Same schema; new backend.

## Directory layout

```
prompts/
├── README.md                     ← you are here
├── VERSIONING.md                 ← how to change a prompt safely
├── explorer/                     ← Explorer agent (Stagehand-driven browser)
│   ├── system.md
│   └── user-template.md
├── generator/                    ← Generator agent (test code emit)
│   ├── system.md
│   └── user-template.md
├── onboarding/                   ← Repo profile extraction
│   ├── profile-extractor.md
│   └── convention-classifier.md
└── judge/                        ← Judge agent (outcome verification)
    └── outcome-verifier.md
```

## File format

Each prompt is a Markdown file with YAML front-matter:

```markdown
---
id: generator.system.v1
role: generator
task_class: generate
model_target: claude-sonnet-4-6
fallback_model: gpt-4o
temperature: 0.2
max_tokens: 4000
owner: agent-team
last_reviewed: 2026-01-15
---

# Generator system prompt

You are a Playwright test generator...
```

Front-matter fields:

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier used in code + spans (e.g., `generator.system.v1`) |
| `role` | Which agent uses this prompt |
| `task_class` | Routes to LLM Gateway task-class table (see design doc §5.8) |
| `model_target` | Preferred model at time of authoring; Gateway may still route elsewhere |
| `fallback_model` | Used if primary fails |
| `temperature`, `max_tokens` | Sampling params |
| `owner` | Team on the hook for this prompt |
| `last_reviewed` | Force a review every 90 days |

Body is the prompt text. Templates use `{{variable}}` syntax; substitution happens in code.

## How prompts are loaded

```typescript
import { loadPrompt } from '@ops/prompts';

const { system, user, meta } = await loadPrompt({
  role: 'generator',
  variables: { goal, examples, repoProfile, exploration },
});

const response = await llmGateway.complete({
  taskClass: meta.task_class,
  system,
  user,
  temperature: meta.temperature,
  maxTokens: meta.max_tokens,
  promptRef: { file: meta.id, hash: meta.hash },
});
```

`meta.hash` is the sha256 of the rendered prompt (system + user + variables merged) and is attached to every OTel span for correlation.

## Changing a prompt

See [VERSIONING.md](./VERSIONING.md) for the full procedure. Short version:

1. Copy `prompts/<role>/system.md` → `system.v2.md`
2. Edit
3. Run `npm run eval -- --prompt generator/system.v2.md`
4. If the eval passes and no metric drops > 5pp, open a PR
5. Merge behind a feature flag; canary at 10% for 24h
6. Promote to 100%; delete v1

**Never edit a prompt in-place** — reviewers must be able to diff old vs. new for spans that ran on old prompts.

## Eval integration

`prompts/eval/` (Q1 wk 6) will contain the 50-triple golden corpus. Each triple: `(goal, repoRef, expected_pr_diff)`.

CI runs eval on every PR touching `prompts/`:
- AST similarity to expected diff
- `playwright test --list` gate pass rate
- Style conformance heuristic
- Cost per resolved test

Regression > 5pp on any metric blocks the merge.

## Q1 prompts (in this folder)

| Prompt | Purpose | Used by |
|--------|---------|---------|
| `explorer/system.md` | Behavior + reporting rules for Stagehand agent | ExplorerWorkflow |
| `explorer/user-template.md` | Per-run instruction with goal + outcomes | ExplorerWorkflow |
| `generator/system.md` | How to write tests in the repo's style | GeneratorWorkflow |
| `generator/user-template.md` | RAG examples + observed actions injected here | GeneratorWorkflow |
| `onboarding/profile-extractor.md` | Extract POM + fixture patterns from repo | OnboardingWorkflow |
| `onboarding/convention-classifier.md` | Classify a single test file's locator style | OnboardingWorkflow |
| `judge/outcome-verifier.md` | Confirm assertions cover expected outcomes | JudgeWorkflow |

## Prompts we do NOT keep here

- **Ephemeral** meta-prompts for tool-calling (constructed at runtime from the manifest)
- **User content** (goals from customers) — always injected as variables, never edited into templates
- **Model provider system tokens** (e.g., Anthropic tool-use JSON schemas) — those live with the SDK adapters

## Reviewer checklist

When you review a prompt PR, verify:

- [ ] Front-matter complete, `last_reviewed` bumped
- [ ] Variables use `{{name}}` syntax; no accidental interpolation of user content
- [ ] No credentials, no example URLs from real customers
- [ ] Eval passed — regression report attached
- [ ] Behavior change described in PR body (not just "improved prompt")
- [ ] Rollback plan (what if this regresses in prod?)
