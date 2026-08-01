#!/usr/bin/env bash
set -Eeuo pipefail

# PocketCloud one-command installer.
# Public repo usage:
#   curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash
# Private repo usage:
#   GITHUB_TOKEN=... sudo -E bash deploy/install.sh

REPO_URL="${POCKETCLOUD_REPO_URL:-https://github.com/designx-studio/pocketcloud.git}"
REF="${POCKETCLOUD_REF:-main}"
INSTALL_DIR="${POCKETCLOUD_INSTALL_DIR:-/opt/pocketcloud}"
COMPOSE_FILE="deploy/docker-compose.yml"

log() { printf '\n[pocketcloud] %s\n' "$*"; }
fail() { printf '\n[pocketcloud] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || fail "Run as root: curl -fsSL <installer-url> | sudo bash"
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then return; fi
  log "Installing Docker Engine and Compose plugin"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin was not installed"
}

fetch_source() {
  local tmp clone_url
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  log "Downloading PocketCloud"
  clone_url="$REPO_URL"
  if [[ -n "${GITHUB_TOKEN:-}" && "$REPO_URL" == https://github.com/* ]]; then
    clone_url="https://x-access-token:${GITHUB_TOKEN}@${REPO_URL#https://}"
  fi
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 --branch "$REF" "$clone_url" "$tmp/pocketcloud"
  else
    [[ -z "${GITHUB_TOKEN:-}" ]] || fail "git is required when installing a private repository"
    curl -fsSL "https://github.com/designx-studio/pocketcloud/archive/refs/heads/${REF}.tar.gz" -o "$tmp/pocketcloud.tar.gz"
    mkdir -p "$tmp/pocketcloud"
    tar -xzf "$tmp/pocketcloud.tar.gz" --strip-components=1 -C "$tmp/pocketcloud"
  fi
  mkdir -p "$INSTALL_DIR"
  cp -a "$tmp/pocketcloud/." "$INSTALL_DIR/"
}

generate_env() {
  local public_host db_password postgres_password
  public_host="${POCKETCLOUD_DOMAIN:-}"
  if [[ -z "$public_host" ]]; then
    public_host="$(curl -4fsSL --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  fi
  [[ -n "$public_host" ]] || fail "Could not determine the public host. Set POCKETCLOUD_DOMAIN and retry."
  if [[ ! -f "$INSTALL_DIR/deploy/.env" ]]; then
    log "Generating deployment secrets"
    umask 077
    db_password="$(openssl rand -hex 32)"
    postgres_password="$db_password"
    cat > "$INSTALL_DIR/deploy/.env" <<EOF
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://pocketcloud:${db_password}@database:5432/pocketcloud?schema=public
POSTGRES_USER=pocketcloud
POSTGRES_PASSWORD=${postgres_password}
JWT_SECRET=$(openssl rand -hex 64)
REFRESH_TOKEN_SECRET=$(openssl rand -hex 64)
ENCRYPTION_KEY=$(openssl rand -hex 32)
CORS_ORIGIN=*
POCKETCLOUD_DOMAIN=${public_host}
EOF
  fi
}

start_stack() {
  cd "$INSTALL_DIR"
  log "Starting PocketCloud services"
  docker compose -f "$COMPOSE_FILE" --env-file deploy/.env up -d --build
  docker compose -f "$COMPOSE_FILE" --env-file deploy/.env ps
}

install_docker
fetch_source
generate_env
start_stack

HOST="${POCKETCLOUD_DOMAIN:-$(hostname -I | awk '{print $1}')}"
log "PocketCloud is ready"
printf 'Dashboard: http://%s\n' "$HOST"
printf 'Node install command: curl -fsSL http://%s/install-agent.sh | bash\n' "$HOST"
