#!/usr/bin/env bash
# Block until the dockerized Postgres accepts connections. The readiness
# probe runs inside the container, so host port mapping is irrelevant here.
set -euo pipefail

PG_USER="${PG_USER:-platform}"
PG_DB="${PG_DB:-platform}"
CONTAINER="${PG_CONTAINER:-test-agent-postgres}"

echo -n "→ Waiting for Postgres in container '${CONTAINER}'"
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -h localhost -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    echo " ✓"
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "✗ Postgres never became ready" >&2
exit 1
