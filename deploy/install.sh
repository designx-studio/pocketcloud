#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${POCKETCLOUD_REPO_URL:-https://github.com/designx-studio/pocketcloud.git}"
REF="${POCKETCLOUD_REF:-main}"
INSTALL_DIR="${POCKETCLOUD_INSTALL_DIR:-/opt/pocketcloud}"
ENV_FILE="${INSTALL_DIR}/.env"
COMPOSE_FILE="deploy/docker-compose.yml"

log() { printf '\n[pocketcloud] %s\n' "$*" >&2; }
log_error() { printf '\n[pocketcloud] ERROR: %s\n' "$*" >&2; }
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

derive_app_url() {
  local host="$1"
  host="${host#"${host%%[![:space:]]*}"}"
  host="${host%"${host##*[![:space:]]}"}"
  host="${host%/}"
  if [[ -z "$host" ]]; then printf 'http://localhost'
  elif [[ "$host" =~ ^https?:// ]]; then printf '%s' "$host"
  elif [[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then printf 'http://%s' "$host"
  else printf 'https://%s' "$host"
  fi
}

derive_ws_url() {
  local app_url="$1"
  case "$app_url" in
    https://*) printf 'wss://%s/ws' "${app_url#https://}" ;;
    http://*) printf 'ws://%s/ws' "${app_url#http://}" ;;
    *) printf 'wss://%s/ws' "$app_url" ;;
  esac
}

validate_required() { local value="$1" name="$2"; [[ -n "$value" ]] || fail "Missing required variable: $name"; }

validate_production_url() {
  local value="$1" name="$2" host_part
  case "$value" in
    https://*) host_part="${value#https://}" ;;
    http://*) host_part="${value#http://}" ;;
    *) fail "$name is not a valid URL: $value" ;;
  esac
  [[ "$value" =~ ^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]+)?(/.*)?$ ]] || fail "$name is not a valid URL: $value"
  host_part="${host_part%%/*}"
  host_part="${host_part%%:*}"
  [[ "$host_part" != "localhost" && "$host_part" != "127.0.0.1" && "$host_part" != "::1" ]] || fail "$name cannot use localhost in production: $value"
  if [[ ! "$host_part" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ && ! "$host_part" =~ \. ]]; then fail "$name host must be a fully-qualified domain or IP: $host_part"; fi
}

read_env_value() { local key="$1" file="$2"; grep -E "^${key}=" "$file" 2>/dev/null | head -n1 | cut -d= -f2- || true; }

validate_env_file() {
  local file="$1" app_url cors_origin database_url postgres_password jwt_secret encryption_key
  [[ -f "$file" ]] || fail "Environment file not found: $file"
  app_url="$(read_env_value APP_URL "$file")"; cors_origin="$(read_env_value CORS_ORIGIN "$file")"; database_url="$(read_env_value DATABASE_URL "$file")"; postgres_password="$(read_env_value POSTGRES_PASSWORD "$file")"; jwt_secret="$(read_env_value JWT_SECRET "$file")"; encryption_key="$(read_env_value ENCRYPTION_KEY "$file")"
  validate_required "$app_url" APP_URL; validate_required "$cors_origin" CORS_ORIGIN; validate_required "$database_url" DATABASE_URL; validate_required "$postgres_password" POSTGRES_PASSWORD; validate_required "$jwt_secret" JWT_SECRET; validate_required "$encryption_key" ENCRYPTION_KEY
  validate_production_url "$app_url" APP_URL; validate_production_url "$cors_origin" CORS_ORIGIN; [[ "$cors_origin" != "*" ]] || fail "CORS_ORIGIN cannot be '*'"
}

prompt_domain() {
  local domain="${POCKETCLOUD_DOMAIN:-}"
  if [[ -z "$domain" && -t 0 && -r /dev/tty ]]; then printf '\nPocketCloud Domain:\n\n' >/dev/tty; read -r -p "" domain </dev/tty || true; fi
  if [[ -z "$domain" ]]; then log_error "Detecting public IP address..."; domain="$(curl -4fsSL --max-time 10 https://api.ipify.org 2>/dev/null || true)"; fi
  if [[ -z "$domain" ]]; then log_error "ipify failed, using local IP detection..."; domain="$(hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 2>/dev/null | awk '{print $7}' || true)"; fi
  [[ -n "$domain" ]] || fail "Could not determine the public host. Set POCKETCLOUD_DOMAIN and retry."
  domain="${domain#"${domain%%[![:space:]]*}"}"; domain="${domain%"${domain##*[![:space:]]}"}"
  case "$domain" in https://*) domain="${domain#https://}";; http://*) domain="${domain#http://}";; esac
  domain="${domain%%/*}"; domain="${domain%/}"
  log_error "Using domain: $domain"
  printf '%s' "$domain"
}

generate_env() {
  local public_host app_url api_url ws_url cors_origin db_password jwt_secret refresh_secret encryption_key domain_only
  if [[ -n "${APP_URL:-}" ]]; then app_url="$APP_URL"; log "Using provided APP_URL: $app_url"; else public_host="$(prompt_domain)"; app_url="$(derive_app_url "$public_host")"; fi
  domain_only="${app_url#https://}"; domain_only="${domain_only#http://}"; domain_only="${domain_only%%/*}"
  api_url="${app_url}/api"; ws_url="$(derive_ws_url "$app_url")"; cors_origin="$app_url"
  printf 'DOMAIN=<%s>\nAPP_URL=<%s>\nCORS_ORIGIN=<%s>\n' "$domain_only" "$app_url" "$cors_origin"
  if [[ -f "$ENV_FILE" ]]; then log "Using existing configuration at $ENV_FILE"; validate_env_file "$ENV_FILE"; ln -sfn ../.env "$INSTALL_DIR/deploy/.env"; return; fi
  umask 077; db_password="$(openssl rand -hex 32)"; jwt_secret="$(openssl rand -hex 64)"; refresh_secret="$(openssl rand -hex 64)"; encryption_key="$(openssl rand -hex 32)"
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
  chmod 600 "$ENV_FILE"; ln -sfn ../.env "$INSTALL_DIR/deploy/.env"; validate_env_file "$ENV_FILE"; log "Configuration valid"
}

wait_for_stack() {
  local attempts=0 max_attempts=60 state
  while (( attempts < max_attempts )); do
    state="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
    if [[ -n "$state" ]] && ! grep -Eq ' (created|restarting|exited|dead)($| )' <<<"$state" && [[ "$(grep -c '^' <<<"$state")" -ge 10 ]] && ! grep -Eq ' (starting|unhealthy)($| )' <<<"$state"; then
      log "All services are running and healthy"; return 0
    fi
    attempts=$((attempts + 1)); sleep 5
  done
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=100
  fail "Timed out waiting for PocketCloud services"
}

start_stack() { cd "$INSTALL_DIR"; log "Starting PocketCloud"; docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build; wait_for_stack; docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps; }

install_docker; fetch_source; generate_env; start_stack
APP_URL_FINAL="$(read_env_value APP_URL "$ENV_FILE")"
log "PocketCloud is ready"
printf 'Dashboard: %s\nAPI: %s\nNode install command: curl -fsSL %s/install-agent.sh | bash\nConfig: %s\n' "$APP_URL_FINAL" "$(read_env_value API_URL "$ENV_FILE")" "$APP_URL_FINAL" "$ENV_FILE"
