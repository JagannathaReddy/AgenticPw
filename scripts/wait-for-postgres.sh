#!/usr/bin/env bash
set -euo pipefail

PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-platform}"
PG_DB="${PG_DB:-platform}"

echo -n "→ Waiting for Postgres at ${PG_HOST}:${PG_PORT}"
for i in $(seq 1 30); do
  if docker exec test-agent-postgres pg_isready -h localhost -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    echo " ✓"
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "✗ Postgres never became ready" >&2
exit 1
