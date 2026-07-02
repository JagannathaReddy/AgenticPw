#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FEATURE="${1:-guest-checkout}"

bash scripts/loop-state.sh init 2>/dev/null || true

echo "Playwright Loop Engineering — feature: $FEATURE"
echo ""
echo "Master loop: Plan → Generate → Run → Heal → Verify"
echo "Docs: docs/LOOP-ENGINEERING.md"
echo ""

if [ ! -f "specs/${FEATURE}.md" ]; then
  bash scripts/plan.sh "$FEATURE"
  echo ""
  echo "Next: run Planner in Cursor/Copilot, then re-run: npm run loop $FEATURE"
  exit 0
fi

if [ ! -f "tests/${FEATURE}.spec.ts" ]; then
  bash scripts/generate.sh "$FEATURE"
  echo ""
  echo "Next: run Generator, then: npm test"
  exit 0
fi

echo "=== RUN PHASE ==="
set +e
npx playwright test "tests/${FEATURE}.spec.ts" tests/seed.spec.ts
EXIT=$?
set -e
node -e "
const fs=require('fs');
const p='.loop/last-run.json';
fs.mkdirSync('.loop',{recursive:true});
fs.writeFileSync(p, JSON.stringify({exitCode:$EXIT, failedTests:[], timestamp:new Date().toISOString()}, null, 2)+'\n');
"

if [ "$EXIT" -eq 0 ]; then
  node scripts/record-loop-state.js pass
  echo "Verify gate passed."
  exit 0
fi

bash scripts/heal.sh "tests/${FEATURE}.spec.ts"
echo ""
echo "Next: run Healer, then: npm run loop:verify"
exit 1
