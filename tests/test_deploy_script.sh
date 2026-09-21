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

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "Expected output not to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

# A checkout with stubbed ssh/git/curl. GIT_LOCAL and GIT_REMOTE stand for the
# local HEAD and origin/main; GIT_DIRTY for uncommitted changes.
make_checkout() {
  local root="$1"
  mkdir -p "$root/app/deploy" "$root/bin" "$root/capture"
  cp "$REPO_ROOT/deploy/deploy.sh" "$root/app/deploy/deploy.sh"
  cp "$REPO_ROOT/deploy/server-setup.sh" "$root/app/deploy/server-setup.sh"

  cat >"$root/bin/ssh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CAPTURE_DIR/ssh_calls"
case "$*" in *"bash -s"*) cat >>"$CAPTURE_DIR/ssh_stdin" ;; esac
EOF

  cat >"$root/bin/git" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"status --porcelain"*) printf '%s' "${GIT_DIRTY:-}" ;;
  *"rev-parse HEAD"*) echo "${GIT_LOCAL:-aaa111}" ;;
  *"rev-parse origin/main"*) echo "${GIT_REMOTE:-aaa111}" ;;
  *) : ;;
esac
EOF

  cat >"$root/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CAPTURE_DIR/curl_calls"
echo '{"status":"ready"}'
EOF

  chmod +x "$root/bin/ssh" "$root/bin/git" "$root/bin/curl" "$root/app/deploy/deploy.sh"
}

# 1. A deploy pulls what was pushed, rebuilds, and waits for readiness.
root="$TEST_ROOT/happy"
make_checkout "$root"
output="$(PATH="$root/bin:$PATH" CAPTURE_DIR="$root/capture" DEPLOY_HOST=gorip DEPLOY_URL=http://example.test \
  bash -c "cd '$root/app' && ./deploy/deploy.sh" 2>&1)"
calls="$(cat "$root/capture/ssh_calls")"
assert_contains "$calls" "gorip"
assert_contains "$calls" "git pull --ff-only"
assert_contains "$calls" "docker compose"
assert_contains "$calls" "deploy/compose.yaml"
assert_contains "$calls" "up -d --build"
assert_contains "$(cat "$root/capture/curl_calls")" "http://example.test/api/ready"
assert_contains "$output" "aaa111"

# 2. Unpushed commits are not on the server's side of `git pull`: refuse.
root="$TEST_ROOT/unpushed"
make_checkout "$root"
if output="$(PATH="$root/bin:$PATH" CAPTURE_DIR="$root/capture" DEPLOY_HOST=gorip GIT_LOCAL=bbb222 GIT_REMOTE=aaa111 \
  bash -c "cd '$root/app' && ./deploy/deploy.sh" 2>&1)"; then
  echo "Expected a deploy with unpushed commits to fail" >&2
  exit 1
fi
assert_contains "$output" "git push"
[ ! -f "$root/capture/ssh_calls" ] || { echo "ssh must not run when commits are unpushed" >&2; exit 1; }

# 3. Uncommitted work is only a warning; what is pushed still deploys.
root="$TEST_ROOT/dirty"
make_checkout "$root"
output="$(PATH="$root/bin:$PATH" CAPTURE_DIR="$root/capture" DEPLOY_HOST=gorip GIT_DIRTY=' M file' \
  bash -c "cd '$root/app' && ./deploy/deploy.sh" 2>&1)"
assert_contains "$output" "uncommitted"
assert_contains "$(cat "$root/capture/ssh_calls")" "up -d --build"

# 4. The host is never guessed.
root="$TEST_ROOT/nohost"
make_checkout "$root"
if output="$(PATH="$root/bin:$PATH" CAPTURE_DIR="$root/capture" \
  bash -c "cd '$root/app' && env -u DEPLOY_HOST ./deploy/deploy.sh" 2>&1)"; then
  echo "Expected a deploy without DEPLOY_HOST to fail" >&2
  exit 1
fi
assert_contains "$output" "DEPLOY_HOST"

# 5. logs and status only read.
root="$TEST_ROOT/read"
make_checkout "$root"
PATH="$root/bin:$PATH" CAPTURE_DIR="$root/capture" DEPLOY_HOST=gorip bash -c "cd '$root/app' && ./deploy/deploy.sh logs api" >/dev/null 2>&1
PATH="$root/bin:$PATH" CAPTURE_DIR="$root/capture" DEPLOY_HOST=gorip bash -c "cd '$root/app' && ./deploy/deploy.sh status" >/dev/null 2>&1
calls="$(cat "$root/capture/ssh_calls")"
assert_contains "$calls" "logs"
assert_contains "$calls" "api"
assert_contains "$calls" " ps"
assert_not_contains "$calls" "git pull"
assert_not_contains "$calls" "up -d"

# 6. setup sends the server script over ssh instead of asking for a manual copy.
root="$TEST_ROOT/setup"
make_checkout "$root"
PATH="$root/bin:$PATH" CAPTURE_DIR="$root/capture" DEPLOY_HOST=gorip DEPLOY_REPO=git@github.com:owner/repo.git \
  bash -c "cd '$root/app' && ./deploy/deploy.sh setup" >/dev/null 2>&1
assert_contains "$(cat "$root/capture/ssh_calls")" "bash -s"
assert_contains "$(cat "$root/capture/ssh_calls")" "git@github.com:owner/repo.git"
assert_contains "$(cat "$root/capture/ssh_stdin")" "docker"

# 7. backup streams a dump to this machine, into a directory git ignores.
root="$TEST_ROOT/backup"
make_checkout "$root"
PATH="$root/bin:$PATH" CAPTURE_DIR="$root/capture" DEPLOY_HOST=gorip bash -c "cd '$root/app' && ./deploy/deploy.sh backup" >/dev/null 2>&1
assert_contains "$(cat "$root/capture/ssh_calls")" "pg_dump"
ls "$root/app/backups/"*.sql.gz >/dev/null
grep -qx 'backups/' "$REPO_ROOT/.gitignore" || { echo "backups/ must be git-ignored" >&2; exit 1; }

echo "deploy script tests passed"
