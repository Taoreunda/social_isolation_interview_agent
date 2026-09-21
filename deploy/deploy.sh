#!/usr/bin/env bash
# Deploys what is on GitHub's main branch to the server, from this machine.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_FILE="$ROOT_DIR/deploy/target.env"
COMPOSE="docker compose -f deploy/compose.yaml"

usage() {
  cat <<'EOF'
Usage: ./deploy/deploy.sh [command]

  deploy (default)   Pull main on the server, rebuild, restart, check readiness
  setup              First time only: install Docker, create a deploy key, clone
  status             Show the server's containers
  logs [service]     Follow server logs (api, web or db; default: all)
  backup             Save a database dump into ./backups on this machine

Settings, from the environment or deploy/target.env:
  DEPLOY_HOST   ssh host or alias from ~/.ssh/config (required)
  DEPLOY_DIR    checkout directory on the server (default: gorip-chatbot)
  DEPLOY_URL    public address, e.g. http://1.2.3.4 — checked after a deploy
  DEPLOY_REPO   git URL the server clones (default: this checkout's origin)
EOF
}

if [ -f "$TARGET_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$TARGET_FILE"
  set +a
fi

DEPLOY_DIR="${DEPLOY_DIR:-gorip-chatbot}"

require_host() {
  if [ -z "${DEPLOY_HOST:-}" ]; then
    echo "DEPLOY_HOST is not set. Put DEPLOY_HOST=<ssh alias> in deploy/target.env." >&2
    exit 1
  fi
}

remote() {
  ssh -n "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && $1"
}

# The server runs `git pull`, so only pushed commits can reach it.
check_pushed() {
  cd "$ROOT_DIR"
  git fetch --quiet origin main
  local local_head remote_head
  local_head="$(git rev-parse HEAD)"
  remote_head="$(git rev-parse origin/main)"
  if [ "$local_head" != "$remote_head" ]; then
    echo "This checkout (${local_head:0:7}) and origin/main (${remote_head:0:7}) differ." >&2
    echo "Run git push (or git pull) first: the server deploys what is on GitHub." >&2
    exit 1
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "Note: uncommitted changes here are not part of this deploy."
  fi
  DEPLOYED_HEAD="${local_head:0:7}"
}

deploy() {
  require_host
  check_pushed
  echo "Deploying $DEPLOYED_HEAD to $DEPLOY_HOST:$DEPLOY_DIR"
  remote "git pull --ff-only && $COMPOSE up -d --build --remove-orphans && docker image prune -f >/dev/null && $COMPOSE ps"
  if [ -n "${DEPLOY_URL:-}" ]; then
    curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-all-errors "${DEPLOY_URL%/}/api/ready"
    echo
  fi
  echo "Deployed $DEPLOYED_HEAD."
}

setup() {
  require_host
  local repo="${DEPLOY_REPO:-$(cd "$ROOT_DIR" && git remote get-url origin)}"
  # The repository is not on the server yet, so the script travels over ssh.
  ssh "$DEPLOY_HOST" "bash -s -- '$repo' '$DEPLOY_DIR'" <"$ROOT_DIR/deploy/server-setup.sh"
}

logs() {
  require_host
  ssh -t "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && $COMPOSE logs -f --tail 100 ${1:-}"
}

backup() {
  require_host
  mkdir -p "$ROOT_DIR/backups"
  local file
  file="$ROOT_DIR/backups/gorip-$(date +%Y%m%d-%H%M%S).sql.gz"
  # Holds participants' answers: keep it off shared disks and out of git.
  (umask 077 && : >"$file")
  if ! remote "set -o pipefail; $COMPOSE exec -T db pg_dump -U dabom dabom | gzip" >"$file"; then
    rm -f "$file"
    echo "Backup failed; nothing was saved." >&2
    exit 1
  fi
  echo "Saved $file"
}

case "${1:-deploy}" in
  deploy) deploy ;;
  setup) setup ;;
  status) require_host; remote "$COMPOSE ps" ;;
  logs) logs "${2:-}" ;;
  backup) backup ;;
  -h | --help | help) usage ;;
  *) usage >&2; exit 1 ;;
esac
