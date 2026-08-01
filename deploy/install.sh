#!/usr/bin/env bash
set -Eeuo pipefail

# PocketCloud one-command installer.
# Public repo usage:
#   curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash
# Private repo usage:
#   GITHUB_TOKEN=... sudo -E bash deploy/install.sh
# Custom domain:
#   curl -fsSL ... | sudo POCKETCLOUD_DOMAIN=cloud.example.com bash

REPO_URL="${POCKETCLOUD_REPO_URL:-https://github.com/designx-studio/pocketcloud.git}"
REF="${POCKETCLOUD_REF:-main}"
INSTALL_DIR="${POCKETCLOUD_INSTALL_DIR:-/opt/pocketcloud}"
# Canonical environment file — every component must use this path.
ENV_FILE="${INSTALL_DIR}/.env"
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
  trap "rm -rf '$tmp'" EXIT
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

# Resolve a bare domain/IP (or full URL) to a production base URL.
# Protocol already present → use as-is (trailing slash stripped).
# Otherwise → https://<host> (or http:// for IP addresses)
derive_app_url() {
  local host="$1"
  host="${host#"${host%%[![:space:]]*}"}"
  host="${host%"${host##*[![:space:]]}"}"
  host="${host%/}"
  if [[ "$host" =~ ^https?:// ]]; then
    printf '%s' "$host"
  else
    # Use http:// for IP addresses, https:// for domains
    if [[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
      printf 'http://%s' "$host"
    else
      printf 'https://%s' "$host"
    fi
  fi
}

# https://host → wss://host ; http://host → ws://host
derive_ws_url() {
  local app_url="$1"
  case "$app_url" in
    https://*) printf 'wss://%s/ws' "${app_url#https://}" ;;
    http://*)  printf 'ws://%s/ws'  "${app_url#http://}"  ;;
    *)         printf 'wss://%s/ws' "$app_url" ;;
  esac
}

validate_required() {
  local value="$1"
  local name="$2"
  if [ -z "$value" ]; then
    echo
    echo "Configuration validation failed."
    echo
    echo "Reason:"
    echo
    echo "Missing required variable: $name"
    echo
    echo "Installation aborted."
    exit 1
  fi
}

# Production: APP_URL and CORS_ORIGIN should be https:// for domains.
# For testing/development, http:// with IP addresses is allowed.
# Rejects wildcards, localhost, and bare hostnames without a dot.
validate_production_url() {
  local value="$1"
  local name="$2"

  if [ -z "$value" ]; then
    echo
    echo "Configuration validation failed."
    echo
    echo "Reason:"
    echo
    echo "$name is empty"
    echo
    echo "Expected:"
    echo
    echo "https://cloud.example.com or http://IP_ADDRESS"
    echo
    echo "Installation aborted."
    exit 1
  fi

  if [ "$value" = "*" ]; then
    echo
    echo "Configuration validation failed."
    echo
    echo "Reason:"
    echo
    echo "$name cannot be '*'"
    echo
    echo "Expected:"
    echo
    echo "https://cloud.example.com or http://IP_ADDRESS"
    echo
    echo "Installation aborted."
    exit 1
  fi

  if [[ ! "$value" =~ ^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]+)?(/.*)?$ ]]; then
    echo
    echo "Configuration validation failed."
    echo
    echo "Reason:"
    echo
    echo "$name is not a valid URL: $value"
    echo
    echo "Expected:"
    echo
    echo "https://cloud.example.com or http://IP_ADDRESS"
    echo
    echo "Installation aborted."
    exit 1
  fi

  local host_part="${value#https?://}"
  host_part="${host_part%%/*}"
  host_part="${host_part%%:*}"

  if [ "$host_part" = "localhost" ] || [ "$host_part" = "127.0.0.1" ] || [ "$host_part" = "::1" ]; then
    echo
    echo "Configuration validation failed."
    echo
    echo "Reason:"
    echo
    echo "$name cannot use localhost in production: $value"
    echo
    echo "Expected:"
    echo
    echo "https://cloud.example.com or http://IP_ADDRESS"
    echo
    echo "Installation aborted."
    exit 1
  fi

  # Reject bare labels like "example" (no dot) unless it is a dotted IPv4 address.
  if [[ ! "$host_part" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] && [[ ! "$host_part" =~ \. ]]; then
    echo
    echo "Configuration validation failed."
    echo
    echo "Reason:"
    echo
    echo "$name host must be a fully-qualified domain or IP: $host_part"
    echo
    echo "Expected:"
    echo
    echo "https://cloud.example.com or http://IP_ADDRESS"
    echo
    echo "Installation aborted."
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local file="$2"
  # shellcheck disable=SC2002
  grep -E "^${key}=" "$file" 2>/dev/null | head -n1 | cut -d= -f2- || true
}

validate_env_file() {
  local file="$1"
  local app_url cors_origin database_url postgres_password jwt_secret encryption_key

  [[ -f "$file" ]] || fail "Environment file not found: $file"

  app_url="$(read_env_value APP_URL "$file")"
  cors_origin="$(read_env_value CORS_ORIGIN "$file")"
  database_url="$(read_env_value DATABASE_URL "$file")"
  postgres_password="$(read_env_value POSTGRES_PASSWORD "$file")"
  jwt_secret="$(read_env_value JWT_SECRET "$file")"
  encryption_key="$(read_env_value ENCRYPTION_KEY "$file")"

  validate_required "$app_url" "APP_URL"
  validate_required "$cors_origin" "CORS_ORIGIN"
  validate_required "$database_url" "DATABASE_URL"
  validate_required "$postgres_password" "POSTGRES_PASSWORD"
  validate_required "$jwt_secret" "JWT_SECRET"
  validate_required "$encryption_key" "ENCRYPTION_KEY"

  validate_production_url "$app_url" "APP_URL"
  validate_production_url "$cors_origin" "CORS_ORIGIN"

  if [ "$cors_origin" = "*" ]; then
    echo
    echo "Configuration validation failed."
    echo
    echo "Reason:"
    echo
    echo "CORS_ORIGIN cannot be '*'"
    echo
    echo "Expected:"
    echo
    echo "https://cloud.example.com or http://IP_ADDRESS"
    echo
    echo "Installation aborted."
    exit 1
  fi
}

prompt_domain() {
  local domain="${POCKETCLOUD_DOMAIN:-}"
  if [[ -z "$domain" && -t 0 && -r /dev/tty ]]; then
    printf '\nPocketCloud Domain:\n\n' >/dev/tty
    read -r -p "" domain </dev/tty || true
  fi
  if [[ -z "$domain" ]]; then
    domain="$(curl -4fsSL --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  fi
  domain="${domain#"${domain%%[![:space:]]*}"}"
  domain="${domain%"${domain##*[![:space:]]}"}"
  domain="${domain%/}"
  # Strip scheme if the operator pasted a full URL into POCKETCLOUD_DOMAIN
  # so derive_app_url can re-apply https consistently when bare host given.
  [[ -n "$domain" ]] || fail "Could not determine the public host. Set POCKETCLOUD_DOMAIN=cloud.example.com and retry."
  printf '%s' "$domain"
}

generate_env() {
  local public_host app_url api_url ws_url cors_origin
  local db_password jwt_secret refresh_secret encryption_key

  public_host="$(prompt_domain)"
  app_url="$(derive_app_url "$public_host")"
  # Host portion for Caddy / POCKETCLOUD_DOMAIN (no scheme)
  local domain_only="${app_url#https://}"
  domain_only="${domain_only#http://}"
  domain_only="${domain_only%%/*}"

  api_url="${app_url}/api"
  ws_url="$(derive_ws_url "$app_url")"
  cors_origin="$app_url"

  if [[ -f "$ENV_FILE" ]]; then
    log "Using existing configuration at $ENV_FILE"
    validate_env_file "$ENV_FILE"
    # Keep deploy/.env in sync with the canonical file for compose relative paths
    ln -sfn ../.env "$INSTALL_DIR/deploy/.env"
    return
  fi

  echo
  echo "Generating configuration..."
  echo

  umask 077
  db_password="$(openssl rand -hex 32)"
  jwt_secret="$(openssl rand -hex 64)"
  refresh_secret="$(openssl rand -hex 64)"
  encryption_key="$(openssl rand -hex 32)"

  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8080
APP_URL=${app_url}
API_URL=${api_url}
WS_URL=${ws_url}
CORS_ORIGIN=${cors_origin}
POCKETCLOUD_DOMAIN=${domain_only}
DATABASE_URL=postgresql://pocketcloud:${db_password}@database:5432/pocketcloud?schema=public
POSTGRES_USER=pocketcloud
POSTGRES_PASSWORD=${db_password}
JWT_SECRET=${jwt_secret}
REFRESH_TOKEN_SECRET=${refresh_secret}
ENCRYPTION_KEY=${encryption_key}
EOF
  chmod 600 "$ENV_FILE"
  # Docker Compose resolves env_file relative to the compose file directory.
  ln -sfn ../.env "$INSTALL_DIR/deploy/.env"

  validate_env_file "$ENV_FILE"

  echo "APP_URL:"
  echo "$app_url"
  echo
  echo "API_URL:"
  echo "$api_url"
  echo
  echo "WS_URL:"
  echo "$ws_url"
  echo
  echo "Database:"
  echo "Configured"
  echo
  echo "JWT:"
  echo "Generated"
  echo
  echo "Encryption:"
  echo "Generated"
  echo
  echo "CORS:"
  echo "$cors_origin"
  echo
  echo "Configuration valid"
  echo
  echo "Environment file: $ENV_FILE"
  echo
}

start_stack() {
  cd "$INSTALL_DIR"
  echo "Starting PocketCloud..."
  echo
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
}

install_docker
fetch_source
generate_env
start_stack

APP_URL_FINAL="$(read_env_value APP_URL "$ENV_FILE")"
log "PocketCloud is ready"
printf 'Dashboard: %s\n' "$APP_URL_FINAL"
printf 'API:       %s\n' "$(read_env_value API_URL "$ENV_FILE")"
printf 'Node install command: curl -fsSL %s/install-agent.sh | bash\n' "$APP_URL_FINAL"
printf 'Config:    %s\n' "$ENV_FILE"
