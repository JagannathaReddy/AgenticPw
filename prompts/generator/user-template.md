---
id: generator.user.v1
role: generator
task_class: generate
owner: agent-team
last_reviewed: 2026-01-15
---

# Generator user prompt template

Variables:
- `{{goal}}` — the user's original goal text
- `{{start_url}}` — target URL
- `{{expected_outcomes}}` — YAML list from the goal
- `{{repo_profile}}` — YAML rendering of the RepoProfile (locator style, POM style, fixtures, auth pattern)
- `{{example_test_1}}`, `{{example_test_2}}`, `{{example_test_3}}` — full contents of three RAG-selected similar tests
- `{{example_page_object_1}}`, etc. — matching page objects
- `{{observed_actions}}` — bulleted action trace from the Explorer
- `{{aria_snapshot_final}}` — a11y tree at the final verified state
- `{{observed_final_url}}` — the URL the browser landed on after the last action

---

## Goal

{{goal}}

**Target URL:** {{start_url}}

**Expected outcomes (each must have an assertion):**

{{expected_outcomes}}

---

## Repository style profile

Match this exactly. This is not a suggestion.

```yaml
{{repo_profile}}
```

---

## Example tests from the same repo

Follow the patterns in these. If a pattern in the examples contradicts your instinct, follow the examples.

### Example 1

```typescript
{{example_test_1}}
```

Page object:

```typescript
{{example_page_object_1}}
```

### Example 2

```typescript
{{example_test_2}}
```

Page object:

```typescript
{{example_page_object_2}}
```

### Example 3

```typescript
{{example_test_3}}
```

Page object:

```typescript
{{example_page_object_3}}
```

---

## Observed browser actions (from Explorer agent)

The Explorer completed the goal successfully with these steps. Replay them in the generated test.

```
{{observed_actions}}
```

## Final observed URL

**{{observed_final_url}}**

Any `toHaveURL` / URL-based assertion in your generated test MUST use this exact URL (or a substring or regex derived from it). Do not invent URL paths from the goal text or from what you remember about the site — use only what was observed.

## Final page state (a11y tree, for locator selection)

```yaml
{{aria_snapshot_final}}
```

---

Emit the two files as specified in the system prompt. No commentary. Only use matchers documented in Playwright (`toBeVisible`, `toHaveText`, `toHaveURL`, `toHaveTitle`, `toHaveCount`, `toBeEnabled`, `toBeChecked`, `toContainText`, `toHaveAttribute`, `toHaveValue`, `toHaveScreenshot`). Do not invent matchers.
