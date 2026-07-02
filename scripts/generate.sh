#!/usr/bin/env bash
FEATURE="${1:-guest-checkout}"
SECTION="${2:-1}"
bash "$(dirname "$0")/loop-state.sh" phase generate
cat << PROMPT

=== GENERATE PHASE ===
Agent: Generator (playwright-test-generator)

Generate tests from specs/${FEATURE}.md section ${SECTION}.
Match tests/seed.spec.ts style. Verify selectors live.
Output: tests/${FEATURE}.spec.ts

Verify gate: npx playwright test --list | grep ${FEATURE}
PROMPT
