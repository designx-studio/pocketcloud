#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${POCKETCLOUD_REPO_URL:-https://github.com/designx-studio/pocketcloud.git}"
REF="${POCKETCLOUD_REF:-main}"
INSTALL_DIR="${POCKETCLOUD_INSTALL_DIR:-/opt/pocketcloud}"
ENV_FILE="${INSTALL_DIR}/.env"
COMPOSE_FILE="deploy/docker-compose.yml"
MODE="auto"
REQUESTED_URL=""

log() { printf '\n[pocketcloud] %s\n' "$*" >&2; }
log_error() { printf '\n[pocketcloud] ERROR: %s\n' "$*" >&2; }
fail() { printf '\n[pocketcloud] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
Usage: install.sh [--ip | --domain DOMAIN | --app-url URL]
  --ip                 Use public IPv4 over HTTP for quick start
  --domain DOMAIN     Use DOMAIN over HTTPS with automatic TLS
  --app-url URL       Use an explicit http://IP or https://DOMAIN URL
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip) [[ "$MODE" == auto ]] || usage; MODE=ip; shift ;;
    --domain) [[ "$MODE" == auto && -n "${2:-}" ]] || usage; MODE=domain; REQUESTED_URL="$2"; shift 2 ;;
    --app-url) [[ "$MODE" == auto && -n "${2:-}" ]] || usage; MODE=url; REQUESTED_URL="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

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
  if [[ -n "${GITHUB_TOKEN:-}" && "$REPO_URL" == https://github.com/* ]]; then clone_url="https://x-access-token:${GITHUB_TOKEN}@${REPO_URL#https://}"; fi
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 --branch "$REF" "$clone_url" "$tmp/pocketcloud"
  else
    [[ -z "${GITHUB_TOKEN:-}" ]] || fail "git is required when installing a private repository"
    curl -fsSL "https://github.com/designx-studio/pocketcloud/archive/refs/heads/${REF}.tar.gz" -o "$tmp/pocketcloud.tar.gz"
    mkdir -p "$tmp/pocketcloud"; tar -xzf "$tmp/pocketcloud.tar.gz" --strip-components=1 -C "$tmp/pocketcloud"
  fi
  mkdir -p "$INSTALL_DIR"; cp -a "$tmp/pocketcloud/." "$INSTALL_DIR/"
}

is_ipv4() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }

normalize_app_url() {
  local value="$1" host
  value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"; value="${value%/}"
  case "$value" in
    http://*) host="${value#http://}"; is_ipv4 "${host%%/*}" || fail "HTTP is only supported for IPv4 quick start URLs: $value"; printf 'http://%s' "${host%%/*}" ;;
    https://*) host="${value#https://}"; host="${host%%/*}"; [[ -n "$host" ]] || fail "Invalid APP_URL: $value"; if is_ipv4 "$host"; then fail "HTTPS for IP addresses requires a certificate; use --ip or http://IP"; fi; [[ "$host" == *.* ]] || fail "Domain must be fully qualified: $host"; printf 'https://%s' "$host" ;;
    *) fail "APP_URL must start with http:// or https://: $value" ;;
  esac
}

detect_public_ip() { curl -4fsSL --max-time 10 https://api.ipify.org 2>/dev/null || true; }

determine_app_url() {
  local detected choice domain
  if [[ -n "${APP_URL:-}" ]]; then normalize_app_url "$APP_URL"; return; fi
  case "$MODE" in
    ip) detected="$(detect_public_ip)"; [[ -n "$detected" ]] || fail "Public IP detection failed; pass --app-url http://IP or --domain DOMAIN"; normalize_app_url "http://$detected" ;;
    domain) domain="$REQUESTED_URL"; [[ "$domain" != http://* && "$domain" != https://* ]] || domain="${domain#http://}"; domain="${domain#https://}"; normalize_app_url "https://$domain" ;;
    url) normalize_app_url "$REQUESTED_URL" ;;
    auto)
      detected="$(detect_public_ip)"
      if [[ -n "$detected" ]]; then
        if [[ -t 0 && -r /dev/tty ]]; then
          printf '\nHow do you want to access PocketCloud?\n\n1. Public IP (quick testing)\n2. Domain name (recommended)\n\nChoose [1/2]: ' >/dev/tty
          read -r choice </dev/tty || choice=1
          if [[ "$choice" == 2 ]]; then printf 'Enter domain name: ' >/dev/tty; read -r domain </dev/tty; [[ -n "$domain" ]] || fail "Domain is required"; normalize_app_url "https://$domain"; else normalize_app_url "http://$detected"; fi
        else normalize_app_url "http://$detected"; fi
      else
        if [[ -t 0 && -r /dev/tty ]]; then printf '\nPublic IP detection failed. Enter a domain name: ' >/dev/tty; read -r domain </dev/tty; [[ -n "$domain" ]] || fail "A domain or --app-url is required"; normalize_app_url "https://$domain"; else fail "Public IP detection failed; pass --ip, --domain DOMAIN, or --app-url URL"; fi
      fi ;;
  esac
}

write_caddyfile() {
  local app_url="$1"
  cat > "$INSTALL_DIR/deploy/Caddyfile" <<EOF
{
  auto_https off
}

${app_url} {
  encode gzip zstd
  @agent-releases path /api/v1/agent/releases/* /api/v1/agent/releases
  handle @agent-releases { reverse_proxy agent-registry:8081 }
  @settings path /api/v1/settings /api/v1/settings/*
  handle @settings { reverse_proxy settings:8082 }
  @api path /api/* /health /docs/*
  handle @api { reverse_proxy api:8080 }
  handle { reverse_proxy dashboard:80 }
  header { -Server -X-Powered-By }
}
EOF
  if [[ "$app_url" == https://* ]]; then sed -i 's/^  auto_https off$/  # automatic HTTPS enabled by Caddy/' "$INSTALL_DIR/deploy/Caddyfile"; fi
}

validate_required() { local value="$1" name="$2"; [[ -n "$value" ]] || fail "Missing required variable: $name"; }

validate_env_file() {
  local file="$1" app_url cors_origin database_url postgres_password jwt_secret encryption_key
  [[ -f "$file" ]] || fail "Environment file not found: $file"
  app_url="$(grep -E '^APP_URL=' "$file" | head -n1 | cut -d= -f2-)"; cors_origin="$(grep -E '^CORS_ORIGIN=' "$file" | head -n1 | cut -d= -f2-)"; database_url="$(grep -E '^DATABASE_URL=' "$file" | head -n1 | cut -d= -f2-)"; postgres_password="$(grep -E '^POSTGRES_PASSWORD=' "$file" | head -n1 | cut -d= -f2-)"; jwt_secret="$(grep -E '^JWT_SECRET=' "$file" | head -n1 | cut -d= -f2-)"; encryption_key="$(grep -E '^ENCRYPTION_KEY=' "$file" | head -n1 | cut -d= -f2-)"
  validate_required "$app_url" APP_URL; validate_required "$cors_origin" CORS_ORIGIN; validate_required "$database_url" DATABASE_URL; validate_required "$postgres_password" POSTGRES_PASSWORD; validate_required "$jwt_secret" JWT_SECRET; validate_required "$encryption_key" ENCRYPTION_KEY
  [[ "$app_url" == http://* || "$app_url" == https://* ]] || fail "APP_URL is invalid: $app_url"
  [[ "$cors_origin" == "$app_url" ]] || fail "CORS_ORIGIN must match APP_URL"
  normalize_app_url "$app_url" >/dev/null
}

generate_env() {
  local app_url="$1" api_url ws_url domain_only db_password jwt_secret refresh_secret encryption_key
  domain_only="${app_url#https://}"; domain_only="${domain_only#http://}"; api_url="${app_url}/api"; [[ "$app_url" == https://* ]] && ws_url="wss://${domain_only}/ws" || ws_url="ws://${domain_only}/ws"
  printf 'DOMAIN=<%s>\nAPP_URL=<%s>\nCORS_ORIGIN=<%s>\n' "$domain_only" "$app_url" "$app_url"
  if [[ -f "$ENV_FILE" && -z "${APP_URL:-}" && "$MODE" == auto ]]; then validate_env_file "$ENV_FILE"; write_caddyfile "$app_url"; return; fi
  umask 077; db_password="$(openssl rand -hex 32)"; jwt_secret="$(openssl rand -hex 64)"; refresh_secret="$(openssl rand -hex 64)"; encryption_key="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8080
APP_URL=${app_url}
API_URL=${api_url}
WS_URL=${ws_url}
CORS_ORIGIN=${app_url}
POCKETCLOUD_DOMAIN=${domain_only}
DATABASE_URL=postgresql://pocketcloud:${db_password}@database:5432/pocketcloud?schema=public
POSTGRES_USER=pocketcloud
POSTGRES_PASSWORD=${db_password}
JWT_SECRET=${jwt_secret}
REFRESH_TOKEN_SECRET=${refresh_secret}
ENCRYPTION_KEY=${encryption_key}
EOF
  chmod 600 "$ENV_FILE"; ln -sfn ../.env "$INSTALL_DIR/deploy/.env"; validate_env_file "$ENV_FILE"; write_caddyfile "$app_url"
  if [[ "$app_url" == http://* ]]; then
    cat >> "$INSTALL_DIR/index.html" <<'EOF'
<script>document.addEventListener('DOMContentLoaded',()=>{const n=document.createElement('div');n.textContent='Running in Quick Start Mode\nHTTPS is disabled because PocketCloud is accessed by IP.\nAdd a domain later to enable automatic TLS.';n.style='position:fixed;bottom:18px;left:18px;z-index:9999;background:#fff7e6;color:#6b4f00;border:1px solid #f5bf38;border-radius:10px;padding:10px 14px;font:600 12px system-ui;white-space:pre-line;box-shadow:0 4px 18px #0002';document.body.appendChild(n)});</script>
EOF
  fi
}

wait_for_stack() {
  local attempts=0 state
  while (( attempts < 60 )); do
    state="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
    if [[ -n "$state" ]] && [[ "$(grep -c '^' <<<"$state")" -ge 10 ]] && ! grep -Eq ' (created|restarting|exited|dead|starting|unhealthy)($| )' <<<"$state"; then return 0; fi
    attempts=$((attempts + 1)); sleep 5
  done
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps; docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=100; fail "Timed out waiting for PocketCloud services"
}

start_stack() { cd "$INSTALL_DIR"; docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build; wait_for_stack; docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps; }

install_docker; fetch_source; FINAL_APP_URL="$(determine_app_url)"; generate_env "$FINAL_APP_URL"; ln -sf "$INSTALL_DIR/scripts/pocketcloud-domain.sh" /usr/local/bin/pocketcloud; chmod +x "$INSTALL_DIR/scripts/pocketcloud-domain.sh"; start_stack
log "PocketCloud is ready"; printf 'Dashboard: %s\nAPI: %s\nConfig: %s\n' "$FINAL_APP_URL" "${FINAL_APP_URL}/api" "$ENV_FILE"
