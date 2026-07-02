#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${AGENT_BASE_URL:-http://127.0.0.1:3847}"
CMD="${1:-}"

fmt_json() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)));"
  fi
}

usage() {
  cat <<'EOF'
Usage: agent-cli.sh <command> [args]

Commands:
  health                         GET /v1/health
  submit <goal> [url] [maxSteps] POST /v1/jobs
  status <jobId>                 GET /v1/jobs/:id
  events <jobId>                 GET /v1/jobs/:id/events (SSE)
  cancel <jobId>                 POST /v1/jobs/:id/cancel
  bridge <jobId>                 POST /v1/jobs/:id/bridge-to-tests
  generate <jobId>               POST /v1/jobs/:id/generate-tests
  verify <jobId>                 POST /v1/jobs/:id/verify-tests
  run-loop <jobId>               POST /v1/jobs/:id/run-loop
EOF
}

case "$CMD" in
  health)
    curl -sS "$BASE_URL/v1/health" | fmt_json
    ;;
  submit)
    GOAL="${2:-}"
    URL="${3:-}"
    MAX_STEPS="${4:-}"
    if [[ -z "$GOAL" ]]; then
      echo "goal required" >&2
      exit 1
    fi
    BODY=$(node -e "
      const goal = process.argv[1];
      const url = process.argv[2];
      const maxSteps = process.argv[3];
      const payload = { goal };
      if (url) payload.url = url;
      if (maxSteps) payload.maxSteps = Number(maxSteps);
      console.log(JSON.stringify(payload));
    " "$GOAL" "$URL" "$MAX_STEPS")
    curl -sS -X POST "$BASE_URL/v1/jobs" \
      -H 'Content-Type: application/json' \
      -d "$BODY" | fmt_json
    ;;
  status)
    JOB_ID="${2:-}"
    [[ -n "$JOB_ID" ]] || { echo "jobId required" >&2; exit 1; }
    curl -sS "$BASE_URL/v1/jobs/$JOB_ID" | fmt_json
    ;;
  events)
    JOB_ID="${2:-}"
    [[ -n "$JOB_ID" ]] || { echo "jobId required" >&2; exit 1; }
    curl -sSN "$BASE_URL/v1/jobs/$JOB_ID/events"
    ;;
  cancel)
    JOB_ID="${2:-}"
    [[ -n "$JOB_ID" ]] || { echo "jobId required" >&2; exit 1; }
    curl -sS -X POST "$BASE_URL/v1/jobs/$JOB_ID/cancel" | fmt_json
    ;;
  bridge)
    JOB_ID="${2:-}"
    [[ -n "$JOB_ID" ]] || { echo "jobId required" >&2; exit 1; }
    curl -sS -X POST "$BASE_URL/v1/jobs/$JOB_ID/bridge-to-tests" | fmt_json
    ;;
  generate)
    JOB_ID="${2:-}"
    [[ -n "$JOB_ID" ]] || { echo "jobId required" >&2; exit 1; }
    curl -sS -X POST "$BASE_URL/v1/jobs/$JOB_ID/generate-tests" | fmt_json
    ;;
  verify)
    JOB_ID="${2:-}"
    [[ -n "$JOB_ID" ]] || { echo "jobId required" >&2; exit 1; }
    curl -sS -X POST "$BASE_URL/v1/jobs/$JOB_ID/verify-tests" | fmt_json
    ;;
  run-loop)
    JOB_ID="${2:-}"
    [[ -n "$JOB_ID" ]] || { echo "jobId required" >&2; exit 1; }
    curl -sS -X POST "$BASE_URL/v1/jobs/$JOB_ID/run-loop" | fmt_json
    ;;
  *)
    usage
    exit 1
    ;;
esac
