#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${AGENT_PORT:-3847}"
BASE_URL="http://127.0.0.1:${PORT}"

cleanup() {
  [[ -n "${AGENT_PID:-}" ]] && kill "$AGENT_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Building agent-server"
npm run agent:build

echo "==> Starting agent daemon"
AGENT_REQUIRE_API_KEY=false npm run agent:dev >/tmp/agent-smoke-daemon.log 2>&1 &
AGENT_PID=$!
for i in $(seq 1 30); do
  if curl -sf "$BASE_URL/v1/health" >/dev/null; then break; fi
  sleep 1
done

echo "==> Health check"
curl -sf "$BASE_URL/v1/health" | tee /tmp/agent-smoke-health.json
echo

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "${GOOGLE_GENERATIVE_AI_API_KEY:-}" ]]; then
  echo "==> No LLM API key — skipping live job (health smoke passed)"
  exit 0
fi

SMOKE_GOAL="${AGENT_SMOKE_GOAL:-}"
SMOKE_URL="${AGENT_SMOKE_URL:-}"

if [[ -z "$SMOKE_GOAL" || -z "$SMOKE_URL" ]]; then
  echo "==> Set AGENT_SMOKE_GOAL and AGENT_SMOKE_URL to run a live job smoke test"
  exit 0
fi

echo "==> Submitting smoke goal"
RESP=$(bash scripts/agent-cli.sh submit "$SMOKE_GOAL" "$SMOKE_URL" 15)
echo "$RESP"
JOB_ID=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.jobId||'');});")
[[ -n "$JOB_ID" ]] || { echo "Missing jobId"; exit 1; }

echo "==> Polling job $JOB_ID"
for i in $(seq 1 120); do
  STATUS=$(curl -sf "$BASE_URL/v1/jobs/$JOB_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{console.log(JSON.parse(d).status);});")
  echo "  status=$STATUS"
  case "$STATUS" in
    succeeded) exit 0 ;;
    failed|cancelled|timeout) curl -sf "$BASE_URL/v1/jobs/$JOB_ID"; exit 1 ;;
  esac
  sleep 5
done

echo "Timed out waiting for job"
exit 1
