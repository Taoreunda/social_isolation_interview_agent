#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

APP_ROOT="$TEST_ROOT/app"
STUB_BIN="$TEST_ROOT/bin"
CAPTURE_DIR="$TEST_ROOT/capture"

mkdir -p "$APP_ROOT/frontend/node_modules" "$APP_ROOT/logs" "$STUB_BIN" "$CAPTURE_DIR"
cp "$REPO_ROOT/run_web_app.sh" "$APP_ROOT/run_web_app.sh"

cat >"$STUB_BIN/lsof" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-iTCP:8001* | *-iTCP:5173*) exit 0 ;;
  *) exit 1 ;;
esac
EOF

cat >"$STUB_BIN/uv" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$CAPTURE_DIR/uv_args"
printf '%s\n' "${AUTH_ALLOWED_ORIGINS:-}" >"$CAPTURE_DIR/auth_allowed_origins"
EOF

cat >"$STUB_BIN/npm" <<'EOF'
#!/usr/bin/env bash
for _attempt in {1..20}; do
  [ -f "$CAPTURE_DIR/auth_allowed_origins" ] && break
  sleep 0.05
done
printf '%s\n' "${VITE_API_PORT:-}" >"$CAPTURE_DIR/npm_api_port"
printf '%s\n' "$*" >"$CAPTURE_DIR/npm_args"
EOF

chmod +x "$STUB_BIN/lsof" "$STUB_BIN/uv" "$STUB_BIN/npm"

output="$(
  PATH="$STUB_BIN:$PATH" \
  CAPTURE_DIR="$CAPTURE_DIR" \
  bash "$APP_ROOT/run_web_app.sh"
)"

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

assert_contains "$output" "Frontend: http://127.0.0.1:5174/"
assert_contains "$output" "API:      http://127.0.0.1:8002/api/health"
assert_equals "$(<"$CAPTURE_DIR/npm_api_port")" "8002" "Vite API port"
assert_equals "$(<"$CAPTURE_DIR/auth_allowed_origins")" "http://127.0.0.1:5174,http://localhost:5174" "Auth allowed origins"
assert_contains "$(<"$CAPTURE_DIR/npm_args")" "--port 5174"
assert_contains "$(<"$CAPTURE_DIR/npm_args")" "--strictPort"
assert_contains "$(<"$CAPTURE_DIR/uv_args")" "run python -m uvicorn"
assert_contains "$(<"$CAPTURE_DIR/uv_args")" "--port 8002"

echo "Port fallback test passed."
