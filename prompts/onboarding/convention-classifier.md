---
id: onboarding.convention-classifier.v1
role: onboarding
task_class: classify
model_target: claude-haiku-4-5-20251001
fallback_model: claude-sonnet-4-6
temperature: 0
max_tokens: 500
owner: agent-team
last_reviewed: 2026-01-15
---

# Single-file convention classifier

Called once per sampled test file during `OnboardingWorkflow`. Extracts a compact fingerprint that the profile extractor aggregates.

Variables:
- `{{file_path}}` — relative path in the repo
- `{{file_content}}` — full file contents

## Output

Valid YAML. No prose. Schema:

```yaml
path: "tests/cart/add-item.spec.ts"
locator_style: getByRole | getByLabel | getByPlaceholder | getByTestId | css | mixed
locator_examples:               # up to 3 real locators from this file, verbatim
  - "page.getByRole('button', { name: 'Add to cart' })"
  - "page.getByTestId('cart-count')"
uses_page_object: true
page_object_import: "./pages/cart.page"
imports_test_from: "@playwright/test"
uses_fixtures: []              # names from test.extend usage
has_soft_assertions: false
has_poll: false
has_snapshots: false
assertion_count: 3
```

## Rules

- Only report **verbatim** locators — do not paraphrase. If you cannot copy them character-for-character, drop them.
- `locator_style: mixed` when the file uses ≥ 2 different top-level patterns for interactive elements.
- `assertion_count` includes `expect(...)`, `expect.soft(...)`, `expect.poll(...)`.
- If the file has zero `expect` calls, set `assertion_count: 0` and note it — this is probably a helper, not a spec.
