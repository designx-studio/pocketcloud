#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${POCKETCLOUD_INSTALL_DIR:-/opt/pocketcloud}"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"

fail(){ echo "[pocketcloud] ERROR: $*" >&2; exit 1; }
[[ "$EUID" -eq 0 ]] || fail "Run as root"
[[ "${1:-}" == "upgrade-domain" && -n "${2:-}" ]] || fail "Usage: pocketcloud upgrade-domain cloud.example.com"
DOMAIN="${2#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"; [[ "$DOMAIN" == *.* ]] || fail "Domain must be fully qualified"
[[ -f "$ENV_FILE" ]] || fail "PocketCloud is not installed at $INSTALL_DIR"

APP_URL="https://$DOMAIN"
DB_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
JWT_SECRET="$(grep '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
REFRESH_TOKEN_SECRET="$(grep '^REFRESH_TOKEN_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
ENCRYPTION_KEY="$(grep '^ENCRYPTION_KEY=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_USER="$(grep '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8080
APP_URL=$APP_URL
API_URL=$APP_URL/api
WS_URL=wss://$DOMAIN/ws
CORS_ORIGIN=$APP_URL
POCKETCLOUD_DOMAIN=$DOMAIN
DATABASE_URL=$DB_URL
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
REFRESH_TOKEN_SECRET=$REFRESH_TOKEN_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
EOF

cat > "$INSTALL_DIR/deploy/Caddyfile" <<EOF
$APP_URL {
  encode gzip zstd
  @agent-releases path /api/v1/agent/releases/* /api/v1/agent/releases
  handle @agent-releases { reverse_proxy agent-registry:8081 }
  @settings path /api/v1/settings /api/v1/settings/*
  handle @settings { reverse_proxy settings:8082 }
  @api path /api/* /health /docs/* /install-agent.sh
  handle @api { reverse_proxy api:8080 }
  handle { reverse_proxy dashboard:80 }
  header { -Server -X-Powered-By }
}
EOF

if [[ -f "$INSTALL_DIR/index.html" ]]; then sed -i '/Running in Quick Start Mode/d' "$INSTALL_DIR/index.html"; fi
cd "$INSTALL_DIR"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate caddy
echo "PocketCloud domain upgraded to $APP_URL"
