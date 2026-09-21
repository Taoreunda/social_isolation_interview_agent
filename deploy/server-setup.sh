#!/usr/bin/env bash
# Runs ON the server, once, sent by `./deploy/deploy.sh setup`. Safe to repeat:
# every step checks whether it is already done.
set -euo pipefail

REPO_URL="${1:?usage: server-setup.sh <git-url> [directory]}"
APP_DIR="${2:-gorip-chatbot}"
KEY_FILE="$HOME/.ssh/gorip_deploy_key"

step() { printf '\n== %s\n' "$1"; }

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script expects Ubuntu or Debian (apt-get)." >&2
  exit 1
fi

step "Docker and git"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2 git openssl
fi
sudo systemctl enable --now docker
if ! id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
  sudo usermod -aG docker "$USER"
  echo "Added $USER to the docker group (applies from the next ssh login)."
fi

step "Swap"
# Building the frontend needs more memory than a small instance has.
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "Created a 2G swap file."
else
  echo "Swap already present."
fi

step "Deploy key"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ ! -f "$KEY_FILE" ]; then
  ssh-keygen -q -t ed25519 -N '' -C "gorip-chatbot deploy key" -f "$KEY_FILE"
fi
if ! grep -q "gorip_deploy_key" "$HOME/.ssh/config" 2>/dev/null; then
  cat >>"$HOME/.ssh/config" <<EOF

Host github.com
  IdentityFile $KEY_FILE
  IdentitiesOnly yes
EOF
  chmod 600 "$HOME/.ssh/config"
fi
# GitHub's published host key, so the first connection is not trusted blindly.
GITHUB_HOST_KEY="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
if ! grep -qF "$GITHUB_HOST_KEY" "$HOME/.ssh/known_hosts" 2>/dev/null; then
  echo "$GITHUB_HOST_KEY" >>"$HOME/.ssh/known_hosts"
fi

if ! git ls-remote "$REPO_URL" >/dev/null 2>&1; then
  cat <<EOF

The server cannot read $REPO_URL yet.
Add this key on GitHub: repository > Settings > Deploy keys > Add deploy key
(leave "Allow write access" unchecked), then run ./deploy/deploy.sh setup again.

$(cat "$KEY_FILE.pub")

EOF
  exit 0
fi

step "Checkout"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "$APP_DIR already cloned."
fi

step "Server settings"
ENV_FILE="$APP_DIR/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  password="$(openssl rand -hex 24)"
  (umask 077 && sed "s/change-me/$password/g" "$APP_DIR/deploy/server.env.example" >"$ENV_FILE")
  echo "Created $ENV_FILE with a generated database password."
else
  echo "$ENV_FILE already exists; left untouched."
fi

cat <<EOF

Setup finished. Still to do by hand, once:
  1. ssh in and edit $ENV_FILE
       OPENAI_API_KEY, AUTH_ALLOWED_ORIGINS (this server's address),
       BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD
  2. From your machine: ./deploy/deploy.sh
EOF
