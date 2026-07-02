#!/usr/bin/env bash
# Applies every SQL migration in order against $DATABASE_URL.
# For local development and CI. Not for production (use node-pg-migrate there).

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set (e.g., postgres://user:pass@host:5432/db)}"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"
MIGRATIONS_DIR="$REPO_ROOT/sql/migrations"

echo "→ Resetting database at $DATABASE_URL"
echo "→ Applying migrations from $MIGRATIONS_DIR"

# Drop and recreate public schema for a clean slate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;
SQL

for migration in "$MIGRATIONS_DIR"/[0-9]*.sql; do
  echo "  · Applying $(basename "$migration")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

echo "✓ Migrations applied."
