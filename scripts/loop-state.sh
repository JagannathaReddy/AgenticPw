#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/.loop/run-log.json"
LAST="$ROOT/.loop/last-run.json"

default_log() {
  cat << 'JSON'
{
  "phase": "plan",
  "iteration": 0,
  "masterIteration": 1,
  "lastAgent": null,
  "testsHealed": [],
  "healAttempts": {},
  "stoppedReason": null
}
JSON
}

cmd="${1:-show}"
case "$cmd" in
  show)
    echo "=== run-log.json ==="
    [ -f "$LOG" ] && cat "$LOG" || echo "(empty)"
    echo "=== last-run.json ==="
    [ -f "$LAST" ] && cat "$LAST" || echo "(empty)"
    ;;
  init)
    mkdir -p "$ROOT/.loop"
    default_log > "$LOG"
    echo "Initialized $LOG"
    ;;
  phase)
    phase="${2:-plan}"
    mkdir -p "$ROOT/.loop"
    [ -f "$LOG" ] || default_log > "$LOG"
    node << NODE
const fs = require('fs');
const p = '$LOG';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.phase = '$phase';
d.iteration = (d.iteration || 0) + 1;
fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
NODE
    ;;
  *)
    echo "Usage: loop-state.sh {show|init|phase <name>}"
    exit 1
    ;;
esac
