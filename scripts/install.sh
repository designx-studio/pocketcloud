#!/usr/bin/env bash
# PocketCloud Control Plane Installer
# Usage: curl -fsSL https://install.pocketcloud.dev | bash
set -Eeuo pipefail

POCKETCLOUD_DOMAIN="${POCKETCLOUD_DOMAIN:-localhost}"
PREFIX=/opt/pocketcloud
REPO_RAW="https://raw.githubusercontent.com/designx-studio/pocketcloud/main"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "This script must be run as root."
[[ -f /etc/os-release ]] || die "Cannot detect operating system."
source /etc/os-release
[[ "$ID" == "ubuntu" ]] || die "Unsupported OS: $ID. Ubuntu 22.04+ required."
[[ "${VERSION_ID%%.*}" -ge 22 ]] || die "Ubuntu $VERSION_ID is too old. Ubuntu 22.04+ required."
info "OS: Ubuntu $VERSION_ID ✔"

TOTAL_MEM_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
[[ $TOTAL_MEM_KB -ge 1500000 ]] || warn "Low memory: $(( TOTAL_MEM_KB / 1024 )) MB. 2 GB recommended."
FREE_KB=$(df -k / | awk 'NR==2{print $4}')
[[ $FREE_KB -ge 15000000 ]] || warn "Low disk space: $(( FREE_KB / 1024 / 1024 )) GB free. 20 GB recommended."

apt-get update -qq
apt-get install -y -qq ca-certificates curl openssl gnupg lsb-release
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi

install -d -m 0750 "$PREFIX" "$PREFIX/config" "$PREFIX/storage/redis" "$PREFIX/storage/caddy" "$PREFIX/database" "$PREFIX/backups" "$PREFIX/logs" "$PREFIX/blueprints" "$PREFIX/agent-releases"
if [[ ! -f "$PREFIX/.env" ]]; then
  PG_PASS=$(openssl rand -hex 32)
  JWT_SECRET=$(openssl rand -hex 64)
  REFRESH_SECRET=$(openssl rand -hex 64)
  ENCRYPTION_KEY=$(openssl rand -base64 32)
  cat > "$PREFIX/.env" <<EOF
NODE_ENV=production
PORT=8080
CORS_ORIGIN=https://${POCKETCLOUD_DOMAIN}
POCKETCLOUD_DOMAIN=${POCKETCLOUD_DOMAIN}
POSTGRES_USER=pocketcloud
POSTGRES_PASSWORD=${PG_PASS}
DATABASE_URL=postgresql://pocketcloud:${PG_PASS}@database:5432/pocketcloud?schema=public
JWT_SECRET=${JWT_SECRET}
REFRESH_TOKEN_SECRET=${REFRESH_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
EOF
  chmod 600 "$PREFIX/.env"
fi

curl --fail --proto '=https' --tlsv1.2 "$REPO_RAW/deploy/docker-compose.yml" -o "$PREFIX/docker-compose.yml"
curl --fail --proto '=https' --tlsv1.2 "$REPO_RAW/deploy/Caddyfile" -o "$PREFIX/Caddyfile"
cd "$PREFIX"
docker compose --env-file .env up -d --build

info "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if docker compose exec -T database pg_isready -U pocketcloud -d pocketcloud >/dev/null 2>&1; then break; fi
  [[ $i -eq 30 ]] && die "PostgreSQL did not become ready in 60 seconds."
  sleep 2
done

docker compose exec -T api npx prisma migrate deploy
info "Waiting for API to become healthy..."
for i in {1..30}; do
  if docker compose exec -T api wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1; then
    info "API is healthy ✔"
    break
  fi
  [[ $i -eq 30 ]] && { docker compose ps; die "API health check failed."; }
  sleep 2
done

echo ""
echo -e "${GREEN}PocketCloud installed successfully!${NC}"
echo "Dashboard: https://${POCKETCLOUD_DOMAIN}"
echo "API Docs:  https://${POCKETCLOUD_DOMAIN}/docs"
echo "Secrets:   $PREFIX/.env"
docker compose ps