---
id: improver.user.v1
role: improver
task_class: generate
owner: agent-team
last_reviewed: 2026-07-03
---

# Improver user prompt

Variables:
- `{{test_path}}` — relative path of the spec being polished
- `{{page_object_path}}` — relative path of an accompanying POM, or "(none)"
- `{{spec_source}}` — current spec source
- `{{page_object_source}}` — current POM source, or "(none)"
- `{{repo_profile}}` — extracted RepoProfile YAML

---

**Improving:** `{{test_path}}`
**Page object:** `{{page_object_path}}`

## Spec source

```typescript
{{spec_source}}
```

## Page object source

```typescript
{{page_object_source}}
```

## Repo style profile

```yaml
{{repo_profile}}
```

Emit the improved file(s) using `===FILE:===END===`, or refuse with `===REFUSE===`. Include a `===NOTES===` block describing what changed. Nothing else.
