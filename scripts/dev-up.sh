#!/usr/bin/env bash
# One-command local bootstrap. Idempotent — safe to re-run.
#
# 1. Starts Postgres via docker compose
# 2. Waits for it to be ready
# 3. Applies migrations
# 4. Seeds a single dev tenant
# 5. Prints the curl command to submit a test manifest

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$REPO_ROOT"

echo "→ Starting Postgres"
docker compose up -d postgres

bash "$SCRIPT_DIR/db-wait-for-postgres.sh"

bash "$SCRIPT_DIR/db-migrate.sh"

echo "→ Seeding dev tenant"
npx tsx "$SCRIPT_DIR/db-seed-dev-tenant.ts"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Local dev environment ready."
echo ""
echo "  Next:"
echo "    npm run dev                          # starts api + worker"
echo ""
echo "  Submit a test manifest:"
cat <<'EOF'
    curl -s -X POST http://127.0.0.1:3000/v1/tests \
      -H 'content-type: application/json' \
      -d '{
        "goal":"Add 3 items to cart and see the cart total match the sum",
        "targetUrl":"https://demo-fixture.example.com/products",
        "expectedOutcomes":["cart badge shows 3","cart total equals sum"]
      }' | jq
EOF
echo ""
echo "  Watch progress:"
echo "    curl -s http://127.0.0.1:3000/v1/tests | jq"
echo "═══════════════════════════════════════════════════════════════════"
