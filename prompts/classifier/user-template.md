---
id: classifier.fallback.user.v1
role: classifier
task_class: classify
owner: agent-team
last_reviewed: 2026-07-03
---

# Fallback classifier user prompt

Variables:
- `{{test_path}}` — relative path of the failing spec
- `{{error_text}}` — Playwright's JSON reporter `errors[].message + stack` (last 2000 chars)
- `{{raw_output_tail}}` — last 1000 chars of combined stdout/stderr (fallback context)

---

**Failing spec:** `{{test_path}}`

**Error text from Playwright JSON reporter:**

```
{{error_text}}
```

**Raw output tail (fallback context — may be empty):**

```
{{raw_output_tail}}
```

Return the strict JSON described in the system prompt.
