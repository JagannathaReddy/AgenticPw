#!/usr/bin/env bash
# Apply every SQL migration in order against the local dev database.
# Uses docker exec so we don't need psql installed on the host.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
MIGRATIONS_DIR="$REPO_ROOT/sql/migrations"

PG_DB="${PG_DB:-platform}"
PG_USER="${PG_USER:-platform}"
CONTAINER="${PG_CONTAINER:-test-agent-postgres}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "✗ Postgres container '${CONTAINER}' is not running." >&2
  echo "  Run: docker compose up -d" >&2
  exit 1
fi

echo "→ Applying migrations from $MIGRATIONS_DIR"

for migration in "$MIGRATIONS_DIR"/[0-9]*.sql; do
  name="$(basename "$migration")"
  echo "  · $name"
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" \
    -f "-" < "$migration" > /dev/null
done

echo "✓ Migrations applied."
