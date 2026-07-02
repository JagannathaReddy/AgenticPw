#!/usr/bin/env bash
FEATURE="${1:-guest-checkout}"
bash "$(dirname "$0")/loop-state.sh" phase plan
cat << PROMPT

=== PLAN PHASE ===
Agent: Planner (playwright-test-planner / @playwright-specialist)

/goal Plan ${FEATURE} for the target application.
Done when specs/${FEATURE}.md exists with numbered scenarios.
Use tests/seed.spec.ts. Explore via MCP or playwright-cli.
Save to specs/${FEATURE}.md. Do not write tests yet.

Verify gate: test -f specs/${FEATURE}.md
PROMPT
