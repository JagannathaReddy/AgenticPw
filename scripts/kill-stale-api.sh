#!/usr/bin/env bash
# Free :3001 before starting the API dev server (stale processes serve old routes).
set -euo pipefail
PORT="${API_PORT:-3001}"
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  if [[ -n "${PIDS}" ]]; then
    echo "→ Killing stale process(es) on :$PORT (${PIDS//$'\n'/ })"
    # shellcheck disable=SC2086
    kill ${PIDS} 2>/dev/null || true
    sleep 0.3
  fi
fi
