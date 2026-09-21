#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$ROOT_DIR/.run"
PID_FILE="$RUNTIME_DIR/dev.pid"
API_PORT_FILE="$RUNTIME_DIR/api.port"
WEB_PORT_FILE="$RUNTIME_DIR/web.port"
RUNNER_LOG="$ROOT_DIR/logs/dev.log"
API_LOG="$ROOT_DIR/logs/api.log"
FRONTEND_LOG="$ROOT_DIR/logs/frontend.log"
RUN_WEB_APP="$ROOT_DIR/run_web_app.sh"
DEV_DATABASE_URL="postgresql+psycopg://dabom:dabom-local@127.0.0.1:54329/dabom"

cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: ./dev.sh <command>

  start [--detach]       Start DB and app; follow logs unless detached
  stop                   Stop app and DB without deleting data
  restart [--detach]     Restart the local stack
  status                 Show process, URL, DB, and API status
  logs [api|frontend|runner|all]
                         Print the latest logs (default: all)
  debug                  Follow API and frontend logs
  admin [username]       Create the first administrator (default: admin)

Without a terminal, set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD in
.env instead: they are read at startup only while no administrator exists.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required but was not found in PATH." >&2
    exit 1
  fi
}

remove_runtime_files() {
  local file
  for file in "$PID_FILE" "$API_PORT_FILE" "$WEB_PORT_FILE"; do
    if [ -e "$file" ]; then
      unlink "$file"
    fi
  done
}

managed_pid() {
  if [ ! -f "$PID_FILE" ]; then
    return 1
  fi
  tr -d '[:space:]' <"$PID_FILE"
}

managed_app_is_running() {
  local pid command_line
  pid="$(managed_pid 2>/dev/null)" || return 1
  case "$pid" in
    '' | *[!0-9]*) return 1 ;;
  esac
  kill -0 "$pid" 2>/dev/null || return 1
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *"$RUN_WEB_APP"* ]]
}

port_is_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

find_available_port() {
  local candidate="$1"
  local reserved_port="${2:-}"
  while [ "$candidate" -le 65535 ]; do
    if [ "$candidate" != "$reserved_port" ] && ! port_is_in_use "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
  done
  echo "No available port found at or above $1." >&2
  return 1
}

prepare_database() {
  require_command docker
  require_command uv
  docker compose up -d --wait db
  DATABASE_URL="$DEV_DATABASE_URL" uv run alembic upgrade head
}

show_urls() {
  if [ -f "$WEB_PORT_FILE" ]; then
    echo "  Frontend: http://127.0.0.1:$(<"$WEB_PORT_FILE")/"
  fi
  if [ -f "$API_PORT_FILE" ]; then
    echo "  API:      http://127.0.0.1:$(<"$API_PORT_FILE")/api/health"
  fi
}

follow_logs() {
  if ! managed_app_is_running; then
    echo "App is not running. Run ./dev.sh start first." >&2
    return 1
  fi
  echo "Following API and frontend logs. Ctrl-C closes this view; the app keeps running."
  trap 'echo; echo "Log view closed. The app is still running."; exit 0' INT
  tail -n 60 -F "$API_LOG" "$FRONTEND_LOG"
}

wait_until_ready() {
  local api_port="$1"
  local attempt=0
  while [ "$attempt" -lt 100 ]; do
    if ! managed_app_is_running; then
      return 1
    fi
    if curl --fail --silent --output /dev/null "http://127.0.0.1:$api_port/api/health" \
      && curl --fail --silent --output /dev/null "http://127.0.0.1:$api_port/api/ready"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.2
  done
  return 1
}

launch_app() {
  local api_port="$1"
  local web_port="$2"

  DATABASE_URL="$DEV_DATABASE_URL" \
    AUTH_COOKIE_SECURE=false \
    API_PORT="$api_port" \
    WEB_PORT="$web_port" \
    uv run python - "$RUN_WEB_APP" "$RUNNER_LOG" <<'PY'
import os
import subprocess
import sys

runner_path, log_path = sys.argv[1:3]
with open(log_path, "ab", buffering=0) as runner_log:
    process = subprocess.Popen(
        [runner_path],
        stdin=subprocess.DEVNULL,
        stdout=runner_log,
        stderr=subprocess.STDOUT,
        env=os.environ.copy(),
        start_new_session=True,
        close_fds=True,
    )
print(process.pid)
PY
}

stop_app_only() {
  local pid pgid attempt=0
  if ! managed_app_is_running; then
    remove_runtime_files
    return 0
  fi
  pid="$(managed_pid)"
  pgid="$(ps -p "$pid" -o pgid= 2>/dev/null | tr -d '[:space:]')"
  if [ "$pgid" != "$pid" ]; then
    echo "Refusing to stop an app outside its isolated process group (PID $pid, PGID $pgid)." >&2
    return 1
  fi

  kill -TERM -- "-$pgid" 2>/dev/null || true
  while kill -0 -- "-$pgid" 2>/dev/null && [ "$attempt" -lt 50 ]; do
    attempt=$((attempt + 1))
    sleep 0.1
  done
  if kill -0 -- "-$pgid" 2>/dev/null; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
    attempt=0
    while kill -0 -- "-$pgid" 2>/dev/null && [ "$attempt" -lt 20 ]; do
      attempt=$((attempt + 1))
      sleep 0.1
    done
  fi
  if kill -0 -- "-$pgid" 2>/dev/null; then
    echo "App process group did not stop (PGID $pgid)." >&2
    return 1
  fi
  remove_runtime_files
}

start_stack() {
  local mode="${1:-}"
  local api_port web_port runner_pid

  if [ "$mode" != "" ] && [ "$mode" != "--detach" ]; then
    echo "Unknown start option: $mode" >&2
    return 2
  fi
  if managed_app_is_running; then
    echo "App is already running."
    show_urls
    if [ "$mode" != "--detach" ]; then
      follow_logs
    fi
    return 0
  fi

  remove_runtime_files
  require_command curl
  require_command lsof
  prepare_database
  mkdir -p "$RUNTIME_DIR" "$ROOT_DIR/logs"
  : >"$RUNNER_LOG"
  : >"$API_LOG"
  : >"$FRONTEND_LOG"

  api_port="$(find_available_port "${API_PORT:-8001}")"
  web_port="$(find_available_port "${WEB_PORT:-5173}" "$api_port")"

  runner_pid="$(launch_app "$api_port" "$web_port")"
  printf '%s\n' "$runner_pid" >"$PID_FILE"
  printf '%s\n' "$api_port" >"$API_PORT_FILE"
  printf '%s\n' "$web_port" >"$WEB_PORT_FILE"

  if ! wait_until_ready "$api_port"; then
    echo "App failed to become ready. Recent launcher output:" >&2
    tail -n 60 "$RUNNER_LOG" >&2 || true
    stop_app_only || true
    docker compose stop db >/dev/null 2>&1 || true
    return 1
  fi

  echo "Local stack is running:"
  show_urls
  if [ "$mode" != "--detach" ]; then
    follow_logs
  else
    echo "Run ./dev.sh debug to follow logs."
  fi
}

stop_stack() {
  require_command docker
  if managed_app_is_running; then
    stop_app_only
    echo "App stopped."
  else
    remove_runtime_files
    echo "App was not running."
  fi
  docker compose stop db
  echo "Database stopped; local data was preserved."
}

show_status() {
  require_command curl
  if managed_app_is_running; then
    echo "App: running"
    show_urls
    if curl --fail --silent --output /dev/null "http://127.0.0.1:$(<"$API_PORT_FILE")/api/ready"; then
      echo "API: ready"
    else
      echo "API: not ready"
    fi
  else
    echo "App: stopped"
  fi

  if command -v docker >/dev/null 2>&1 \
    && docker compose ps --status running --services 2>/dev/null | grep -qx 'db'; then
    echo "Database: running"
  else
    echo "Database: stopped"
  fi
}

show_logs() {
  local target="${1:-all}"
  case "$target" in
    api) tail -n 100 "$API_LOG" ;;
    frontend) tail -n 100 "$FRONTEND_LOG" ;;
    runner) tail -n 100 "$RUNNER_LOG" ;;
    all) tail -n 100 "$RUNNER_LOG" "$API_LOG" "$FRONTEND_LOG" ;;
    *)
      echo "Unknown log target: $target" >&2
      return 2
      ;;
  esac
}

create_admin() {
  local username="${1:-admin}"
  prepare_database
  DATABASE_URL="$DEV_DATABASE_URL" \
    uv run python backend/manage.py bootstrap-admin --username "$username"
}

command="${1:-help}"
case "$command" in
  start) start_stack "${2:-}" ;;
  stop) stop_stack ;;
  restart)
    stop_stack
    start_stack "${2:-}"
    ;;
  status) show_status ;;
  logs) show_logs "${2:-all}" ;;
  debug) follow_logs ;;
  admin) create_admin "${2:-admin}" ;;
  help | -h | --help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
