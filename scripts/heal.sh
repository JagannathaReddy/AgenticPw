#!/usr/bin/env bash
TEST="${1:-tests/guest-checkout.spec.ts}"
bash "$(dirname "$0")/loop-state.sh" phase heal
cat << PROMPT

=== HEAL PHASE ===
Agent: Healer (playwright-test-healer)

/loop Run npx playwright test ${TEST} --trace on-first-retry
If failing: smallest fix, rerun. Max 3 attempts.
Update .loop/run-log.json. Skip with reason if feature broken.

Verify gate: npx playwright test ${TEST}
PROMPT
