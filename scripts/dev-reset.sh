#!/usr/bin/env bash
# Nuke the local database and re-bootstrap. Destroys the docker volume.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$REPO_ROOT"

echo "⚠  This will drop the local Postgres volume (test-agent-postgres-data)."
read -rp "Continue? [y/N] " reply
if [[ "${reply,,}" != "y" ]]; then
  echo "Aborted."
  exit 1
fi

docker compose down -v
bash "$SCRIPT_DIR/dev-up.sh"
