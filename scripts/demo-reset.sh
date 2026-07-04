#!/usr/bin/env bash
# demo-reset.sh — put the platform in a clean, recordable state.
#
# Not for production. This drops the Postgres volume, wipes generated
# tests, and reboots the dev processes so a Loom recording starts from a
# predictable baseline.
#
# Usage:
#   bash scripts/demo-reset.sh
#   npm run dev            # then in another terminal

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$REPO_ROOT"

echo "════════════════════════════════════════════════════════"
echo "  Demo reset — clean state for recording"
echo "════════════════════════════════════════════════════════"

echo "→ Stopping dev processes"
pkill -f "tsx apps/" 2>/dev/null || true
sleep 1

echo "→ Dropping Postgres volume"
docker compose down -v 2>&1 | tail -3

echo "→ Removing generated tests, artifacts, and cache"
rm -rf tests/autonomous tests/triaged local-artifacts test-results playwright-report

echo "→ Starting fresh Postgres"
docker compose up -d
# Wait until Postgres is ready to accept connections
for i in {1..20}; do
  if docker exec test-agent-postgres pg_isready -U platform -d platform >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "→ Applying migrations"
bash "$SCRIPT_DIR/db-migrate.sh" 2>&1 | grep -v NOTICE | tail -12

echo "→ Seeding dev tenant"
npx tsx "$SCRIPT_DIR/db-seed-dev-tenant.ts" 2>&1 | tail -5

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Clean. Ready to record."
echo ""
echo "  Next two terminals:"
echo "    Terminal A:  npm run dev"
echo "    Terminal B:  follow docs/DEMO-SCRIPT.md"
echo "════════════════════════════════════════════════════════"
