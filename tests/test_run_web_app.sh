#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

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

# Builds a copy of the runner with stubbed tools under $1.
make_app() {
  local root="$1"
  mkdir -p "$root/app/frontend/node_modules" "$root/app/logs" "$root/bin" "$root/capture"
  cp "$REPO_ROOT/run_web_app.sh" "$root/app/run_web_app.sh"

  cat >"$root/bin/lsof" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-iTCP:8001* | *-iTCP:5173*) exit 0 ;;
  *) exit 1 ;;
esac
EOF

  cat >"$root/bin/uv" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$CAPTURE_DIR/uv_args"
printf '%s\n' "${DATABASE_URL:-}" >"$CAPTURE_DIR/database_url"
printf '%s\n' "${AUTH_ALLOWED_ORIGINS:-}" >"$CAPTURE_DIR/auth_allowed_origins"
EOF

  cat >"$root/bin/npm" <<'EOF'
#!/usr/bin/env bash
for _attempt in {1..20}; do
  [ -f "$CAPTURE_DIR/auth_allowed_origins" ] && break
  sleep 0.05
done
printf '%s\n' "${VITE_API_PORT:-}" >"$CAPTURE_DIR/npm_api_port"
printf '%s\n' "$*" >"$CAPTURE_DIR/npm_args"
EOF

  cat >"$root/app/dev.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$CAPTURE_DIR/dev_args"
echo "dev.sh stub"
EOF

  chmod +x "$root/bin/lsof" "$root/bin/uv" "$root/bin/npm" "$root/app/dev.sh"
}

# As ./dev.sh runs it: the database URL is provided, so the runner starts the stack.
MANAGED="$TEST_ROOT/managed"
make_app "$MANAGED"
output="$(
  PATH="$MANAGED/bin:$PATH" \
  CAPTURE_DIR="$MANAGED/capture" \
  DATABASE_URL="postgresql+psycopg://runner-test@127.0.0.1:54329/dabom" \
  bash "$MANAGED/app/run_web_app.sh"
)"
capture="$MANAGED/capture"
assert_contains "$output" "Frontend: http://127.0.0.1:5174/"
assert_contains "$output" "API:      http://127.0.0.1:8002/api/health"
assert_equals "$(<"$capture/npm_api_port")" "8002" "Vite API port"
assert_equals "$(<"$capture/auth_allowed_origins")" "http://127.0.0.1:5174,http://localhost:5174" "Auth allowed origins"
assert_equals "$(<"$capture/database_url")" "postgresql+psycopg://runner-test@127.0.0.1:54329/dabom" "API database URL"
assert_contains "$(<"$capture/npm_args")" "--port 5174"
assert_contains "$(<"$capture/npm_args")" "--strictPort"
assert_contains "$(<"$capture/uv_args")" "run python -m uvicorn"
assert_contains "$(<"$capture/uv_args")" "--port 8002"
echo "Port fallback test passed."

# Run directly: no database URL, so the runner hands over to ./dev.sh instead of
# starting an API that cannot reach its database.
DIRECT="$TEST_ROOT/direct"
make_app "$DIRECT"
output="$(
  env -u DATABASE_URL \
  PATH="$DIRECT/bin:$PATH" \
  CAPTURE_DIR="$DIRECT/capture" \
  bash "$DIRECT/app/run_web_app.sh"
)"
capture="$DIRECT/capture"
assert_contains "$output" "./dev.sh"
assert_equals "$(cat "$capture/dev_args" 2>/dev/null || true)" "start" "Hand-off command"
if [ -e "$capture/uv_args" ]; then
  echo "Runner started an API without a database URL: $(<"$capture/uv_args")" >&2
  exit 1
fi
echo "Direct run hand-off test passed."
