---
id: healer.user.v1
role: healer
task_class: generate
owner: agent-team
last_reviewed: 2026-07-03
---

# Healer user prompt template

Variables:
- `{{test_path}}` — relative path of the failing spec
- `{{page_object_path}}` — relative path of the accompanying page object (or "(none)")
- `{{failure_category}}` — classification result: locator_drift / timing / …
- `{{failure_summary}}` — one-sentence machine-generated summary of the failure
- `{{failure_output_tail}}` — last ~2000 chars of Playwright output (stderr + stdout)
- `{{spec_source}}` — current contents of the spec file
- `{{page_object_source}}` — current contents of the page object (or "(none — spec has no separate POM)")
- `{{aria_snapshot}}` — current a11y tree of the target page (or "(none captured)")
- `{{repo_profile}}` — extracted RepoProfile YAML, or heuristic summary
- `{{related_sources}}` — helper files from the failure's stack trace / --include globs (read-only context; you cannot patch these)

---

## Failing test

**Spec:** `{{test_path}}`
**Page object:** `{{page_object_path}}`

## Failure

**Category:** `{{failure_category}}`
**Summary:** {{failure_summary}}

**Playwright output tail:**

```
{{failure_output_tail}}
```

## Current a11y tree at the target page

```yaml
{{aria_snapshot}}
```

## Current spec source

```typescript
{{spec_source}}
```

## Current page object source

```typescript
{{page_object_source}}
```

## Related sources from the stack trace (read-only — you may NOT patch these)

{{related_sources}}

## Repo style guidance

{{repo_profile}}

---

Emit the patched file(s) using the `===FILE:===END===` markers, or refuse using `===REFUSE===`. Nothing else.
