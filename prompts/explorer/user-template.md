---
id: explorer.user.v1
role: explorer
task_class: plan
owner: agent-team
last_reviewed: 2026-01-15
---

# Explorer user prompt template

Variables:
- `{{goal}}` — free-text description of the flow to accomplish
- `{{start_url}}` — the URL already loaded in the browser
- `{{credentials_block}}` — either `username=..., password=...` or the string `(none provided — infer only from the goal)`
- `{{expected_outcomes_list}}` — numbered list of outcomes the agent must verify
- `{{step_hints_list}}` — numbered list of steps derived from the goal
- `{{prior_flow_note}}` — optional; injected only when a memory match exists

---

## Task

{{goal}}

## Context

Start page: {{start_url}} (already loaded — do not re-navigate unless the goal says to).

Credentials: {{credentials_block}}

## Steps (from the goal — follow in order)

{{step_hints_list}}

## Expected outcomes (must verify on screen before finishing)

{{expected_outcomes_list}}

{{prior_flow_note}}

---

Finish only when every expected outcome is verified on screen, or stop with a clear failure reason. Do not claim success without on-screen evidence.
