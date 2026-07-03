---
id: steward.user.v1
role: steward
task_class: classify
owner: agent-team
last_reviewed: 2026-07-04
---

# Steward user prompt

Variables:
- `{{repo_name}}` — display name of the repo, or "(default)"
- `{{runs}}` — how many full-suite passes were made
- `{{scoreboard_json}}` — counts: total/healthy/flaky/alwaysFailing/skipped
- `{{problem_tests_json}}` — ranked problem tests with verdicts, categories, error heads

---

Suite: `{{repo_name}}` — {{runs}} full-suite runs.

## Scoreboard

```json
{{scoreboard_json}}
```

## Problem tests (ranked, empty array when green)

```json
{{problem_tests_json}}
```

Write the executive summary.
