#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUESTED_API_PORT="${API_PORT:-8001}"
REQUESTED_WEB_PORT="${WEB_PORT:-5173}"
API_LOG="$ROOT_DIR/logs/api.log"
WEB_LOG="$ROOT_DIR/logs/frontend.log"

cd "$ROOT_DIR"
mkdir -p "$ROOT_DIR/logs"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

port_is_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

find_available_port() {
  local requested_port="$1"
  local reserved_port="${2:-}"
  local candidate="$requested_port"

  while [ "$candidate" -le 65535 ]; do
    if [ "$candidate" != "$reserved_port" ] && ! port_is_in_use "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
  done

  echo "No available port found at or above $requested_port." >&2
  return 1
}

API_PORT="$(find_available_port "$REQUESTED_API_PORT")"
WEB_PORT="$(find_available_port "$REQUESTED_WEB_PORT" "$API_PORT")"
LOCAL_AUTH_ALLOWED_ORIGINS="http://127.0.0.1:$WEB_PORT,http://localhost:$WEB_PORT"
if [ -n "${AUTH_ALLOWED_ORIGINS:-}" ]; then
  LOCAL_AUTH_ALLOWED_ORIGINS="$LOCAL_AUTH_ALLOWED_ORIGINS,$AUTH_ALLOWED_ORIGINS"
fi

if [ "$API_PORT" != "$REQUESTED_API_PORT" ]; then
  echo "Port $REQUESTED_API_PORT is in use; using API port $API_PORT."
fi
if [ "$WEB_PORT" != "$REQUESTED_WEB_PORT" ]; then
  echo "Port $REQUESTED_WEB_PORT is in use; using frontend port $WEB_PORT."
fi

echo "Starting FastAPI backend on http://127.0.0.1:$API_PORT"
# Ignore SIGHUP so a detached stack outlives the shell that launched it.
AUTH_ALLOWED_ORIGINS="$LOCAL_AUTH_ALLOWED_ORIGINS" \
  nohup uv run python -m uvicorn api:app --app-dir backend --reload --host 127.0.0.1 --port "$API_PORT" >"$API_LOG" 2>&1 &
API_PID=$!

if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  (cd "$ROOT_DIR/frontend" && npm install)
fi

echo "Starting React frontend on http://127.0.0.1:$WEB_PORT/"
nohup sh -c '
  cd "$1/frontend"
  VITE_API_PORT="$2" npm run dev -- --host 127.0.0.1 --port "$3" --strictPort
' _ "$ROOT_DIR" "$API_PORT" "$WEB_PORT" >"$WEB_LOG" 2>&1 &
WEB_PID=$!

cleanup() {
  echo
  echo "Stopping web app..."
  if [ -n "${WEB_PID:-}" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [ -n "${API_PID:-}" ]; then
    kill "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

echo
echo "Web app is starting:"
echo "  Frontend: http://127.0.0.1:$WEB_PORT/"
echo "  API:      http://127.0.0.1:$API_PORT/api/health"
echo
echo "Logs:"
echo "  API:      $API_LOG"
echo "  Frontend: $WEB_LOG"
echo
echo "Press Ctrl-C to stop both servers."

wait "$WEB_PID"
