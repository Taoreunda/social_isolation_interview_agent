#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
APP_ROOT="$TEST_ROOT/app"
STUB_BIN="$TEST_ROOT/bin"
CAPTURE_DIR="$TEST_ROOT/capture"

cleanup() {
  if [ -f "$APP_ROOT/.run/dev.pid" ]; then
    managed_pid="$(<"$APP_ROOT/.run/dev.pid")"
    kill "$managed_pid" 2>/dev/null || true
  fi
  if [ -f "$CAPTURE_DIR/runner_child_pid" ]; then
    runner_child_pid="$(<"$CAPTURE_DIR/runner_child_pid")"
    kill "$runner_child_pid" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$APP_ROOT/frontend/node_modules" "$APP_ROOT/logs" "$STUB_BIN" "$CAPTURE_DIR"
cp "$REPO_ROOT/dev.sh" "$APP_ROOT/dev.sh"

cat >"$APP_ROOT/run_web_app.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s|%s\n' "$DATABASE_URL" "$API_PORT" "$WEB_PORT" >"$CAPTURE_DIR/runner_env"
trap 'exit 0' TERM INT
(
  trap 'exit 0' TERM INT
  while true; do sleep 0.1; done
) &
printf '%s\n' "$!" >"$CAPTURE_DIR/runner_child_pid"
while true; do sleep 0.1; done
EOF

cat >"$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CAPTURE_DIR/docker_calls"
EOF

cat >"$STUB_BIN/uv" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s\n' "${DATABASE_URL:-}" "$*" >>"$CAPTURE_DIR/uv_calls"
if [ "${1:-}" = "run" ] && [ "${2:-}" = "python" ] && [ "${3:-}" = "-" ]; then
  shift 2
  exec python3 "$@"
fi
EOF

cat >"$STUB_BIN/lsof" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-iTCP:8001* | *-iTCP:5173*) exit 0 ;;
  *) exit 1 ;;
esac
EOF

cat >"$STUB_BIN/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$APP_ROOT/dev.sh" "$APP_ROOT/run_web_app.sh" "$STUB_BIN"/*

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "Expected output to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

run_dev() {
  PATH="$STUB_BIN:$PATH" CAPTURE_DIR="$CAPTURE_DIR" bash "$APP_ROOT/dev.sh" "$@"
}

start_output="$(run_dev start --detach)"
assert_contains "$start_output" "Frontend: http://127.0.0.1:5174/"
assert_contains "$start_output" "API:      http://127.0.0.1:8002/api/health"

for _attempt in {1..20}; do
  [ -f "$CAPTURE_DIR/runner_env" ] && break
  sleep 0.05
done

expected_database_url="postgresql+psycopg://dabom:dabom-local@127.0.0.1:54329/dabom"
if [ "$(<"$CAPTURE_DIR/runner_env")" != "$expected_database_url|8002|5174" ]; then
  echo "The managed app did not receive the local database and selected ports." >&2
  exit 1
fi
assert_contains "$(<"$CAPTURE_DIR/docker_calls")" "compose up -d --wait db"
assert_contains "$(<"$CAPTURE_DIR/uv_calls")" "$expected_database_url|run alembic upgrade head"

managed_pid="$(<"$APP_ROOT/.run/dev.pid")"
managed_pgid="$(ps -o pgid= -p "$managed_pid" | tr -d '[:space:]')"
if [ "$managed_pgid" != "$managed_pid" ]; then
  echo "The managed app was not isolated in its own process group." >&2
  exit 1
fi

status_output="$(run_dev status)"
assert_contains "$status_output" "App: running"
assert_contains "$status_output" "API: ready"

run_dev admin >/dev/null
assert_contains "$(<"$CAPTURE_DIR/uv_calls")" "$expected_database_url|run python backend/manage.py bootstrap-admin --username admin"

printf 'api-line\n' >"$APP_ROOT/logs/api.log"
printf 'frontend-line\n' >"$APP_ROOT/logs/frontend.log"
logs_output="$(run_dev logs all)"
assert_contains "$logs_output" "api-line"
assert_contains "$logs_output" "frontend-line"

run_dev stop >/dev/null
if kill -0 "$managed_pid" 2>/dev/null; then
  echo "The managed app is still running after stop." >&2
  exit 1
fi
runner_child_pid="$(<"$CAPTURE_DIR/runner_child_pid")"
if kill -0 "$runner_child_pid" 2>/dev/null; then
  echo "A child process is still running after stop." >&2
  exit 1
fi
if [ -e "$APP_ROOT/.run/dev.pid" ]; then
  echo "The runtime PID was not removed after stop." >&2
  exit 1
fi
assert_contains "$(<"$CAPTURE_DIR/docker_calls")" "compose stop db"

echo "Developer command test passed."
