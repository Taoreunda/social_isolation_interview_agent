#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
APP_ROOT="$TEST_ROOT/app"
STUB_BIN="$TEST_ROOT/bin"
CAPTURE_DIR="$TEST_ROOT/capture"

cleanup() {
  local file
  for file in "$APP_ROOT/.run/dev.pid" "$CAPTURE_DIR/api_pid" "$CAPTURE_DIR/frontend_pid"; do
    if [ -f "$file" ]; then
      kill "$(<"$file")" 2>/dev/null || true
    fi
  done
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$APP_ROOT/frontend/node_modules" "$APP_ROOT/logs" "$STUB_BIN" "$CAPTURE_DIR"
cp "$REPO_ROOT/dev.sh" "$APP_ROOT/dev.sh"

cat >"$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CAPTURE_DIR/docker_calls"
EOF

# `uv run python -` is the launcher, `uv run python -m uvicorn` the API (it stays
# up like the real one), anything else a one-shot command such as alembic.
cat >"$STUB_BIN/uv" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s\n' "${DATABASE_URL:-}" "$*" >>"$CAPTURE_DIR/uv_calls"
if [ "${1:-}" = "run" ] && [ "${2:-}" = "python" ] && [ "${3:-}" = "-" ]; then
  shift 2
  exec python3 "$@"
fi
case "$*" in
  *uvicorn*)
    printf '%s\n' "$*" >"$CAPTURE_DIR/api_args"
    printf '%s\n' "${DATABASE_URL:-}" >"$CAPTURE_DIR/api_database_url"
    printf '%s\n' "${AUTH_ALLOWED_ORIGINS:-}" >"$CAPTURE_DIR/api_allowed_origins"
    printf '%s\n' "${AUTH_COOKIE_SECURE:-}" >"$CAPTURE_DIR/api_cookie_secure"
    printf '%s\n' "$$" >"$CAPTURE_DIR/api_pid"
    trap 'exit 0' TERM INT
    while true; do sleep 0.1; done
    ;;
esac
EOF

cat >"$STUB_BIN/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$CAPTURE_DIR/frontend_args"
printf '%s\n' "${VITE_API_PORT:-}" >"$CAPTURE_DIR/frontend_api_port"
printf '%s\n' "$$" >"$CAPTURE_DIR/frontend_pid"
trap 'exit 0' TERM INT
while true; do sleep 0.1; done
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

chmod +x "$APP_ROOT/dev.sh" "$STUB_BIN"/*

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "Expected output to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

assert_equals() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label: expected '$expected', got '$actual'" >&2
    exit 1
  fi
}

run_dev() {
  PATH="$STUB_BIN:$PATH" CAPTURE_DIR="$CAPTURE_DIR" bash "$APP_ROOT/dev.sh" "$@"
}

# 8001 and 5173 are taken, so the stack moves to the next free ports.
start_output="$(run_dev start --detach)"
assert_contains "$start_output" "Frontend: http://127.0.0.1:5174/"
assert_contains "$start_output" "API:      http://127.0.0.1:8002/api/health"

for _attempt in {1..40}; do
  [ -f "$CAPTURE_DIR/api_pid" ] && [ -f "$CAPTURE_DIR/frontend_pid" ] && break
  sleep 0.05
done

expected_database_url="postgresql+psycopg://dabom:dabom-local@127.0.0.1:54329/dabom"
assert_contains "$(<"$CAPTURE_DIR/docker_calls")" "compose up -d --wait db"
assert_contains "$(<"$CAPTURE_DIR/uv_calls")" "$expected_database_url|run alembic upgrade head"

# The API gets the local database, the chosen port, and the frontend's origin.
assert_equals "$(<"$CAPTURE_DIR/api_database_url")" "$expected_database_url" "API database URL"
assert_contains "$(<"$CAPTURE_DIR/api_args")" "run python -m uvicorn"
assert_contains "$(<"$CAPTURE_DIR/api_args")" "--port 8002"
assert_equals "$(<"$CAPTURE_DIR/api_allowed_origins")" "http://127.0.0.1:5174,http://localhost:5174" "Auth allowed origins"
assert_equals "$(<"$CAPTURE_DIR/api_cookie_secure")" "false" "Cookie Secure flag"

# Vite proxies /api to the chosen API port and never drifts to another port itself.
assert_equals "$(<"$CAPTURE_DIR/frontend_api_port")" "8002" "Vite API port"
assert_contains "$(<"$CAPTURE_DIR/frontend_args")" "--port 5174"
assert_contains "$(<"$CAPTURE_DIR/frontend_args")" "--strictPort"

managed_pid="$(<"$APP_ROOT/.run/dev.pid")"
managed_pgid="$(ps -o pgid= -p "$managed_pid" | tr -d '[:space:]')"
if [ "$managed_pgid" != "$managed_pid" ]; then
  echo "The managed app was not isolated in its own process group." >&2
  exit 1
fi

status_output="$(run_dev status)"
assert_contains "$status_output" "App: running"
assert_contains "$status_output" "API: ready"

again_output="$(run_dev start --detach)"
assert_contains "$again_output" "already running"

run_dev admin >/dev/null
assert_contains "$(<"$CAPTURE_DIR/uv_calls")" "$expected_database_url|run python backend/manage.py bootstrap-admin --username admin"

printf 'api-line\n' >"$APP_ROOT/logs/api.log"
printf 'frontend-line\n' >"$APP_ROOT/logs/frontend.log"
logs_output="$(run_dev logs all)"
assert_contains "$logs_output" "api-line"
assert_contains "$logs_output" "frontend-line"

api_pid="$(<"$CAPTURE_DIR/api_pid")"
frontend_pid="$(<"$CAPTURE_DIR/frontend_pid")"
run_dev stop >/dev/null
for pid in "$managed_pid" "$api_pid" "$frontend_pid"; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "Process $pid is still running after stop." >&2
    exit 1
  fi
done
if [ -e "$APP_ROOT/.run/dev.pid" ]; then
  echo "The runtime PID was not removed after stop." >&2
  exit 1
fi
assert_contains "$(<"$CAPTURE_DIR/docker_calls")" "compose stop db"

# The part that serves is internal: it is not advertised, and it refuses to run
# without the database ./dev.sh start prepares.
help_output="$(run_dev help)"
if [[ "$help_output" == *"__serve"* ]]; then
  echo "The internal serve command is advertised in the help." >&2
  exit 1
fi
if serve_output="$(env -u DATABASE_URL PATH="$STUB_BIN:$PATH" CAPTURE_DIR="$CAPTURE_DIR" bash "$APP_ROOT/dev.sh" __serve 2>&1)"; then
  echo "Expected __serve without a database URL to fail." >&2
  exit 1
fi
assert_contains "$serve_output" "./dev.sh start"

echo "Developer command test passed."
