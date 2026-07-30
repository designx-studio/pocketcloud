#!/usr/bin/env bash
# PocketCloud Control Plane Installer
# Usage: curl -fsSL https://install.pocketcloud.dev | bash
# Supports: Ubuntu 22.04+
# Requirements: 2 GB RAM, 20 GB disk, root access

set -Eeuo pipefail

POCKETCLOUD_DOMAIN="${POCKETCLOUD_DOMAIN:-localhost}"
PREFIX=/opt/pocketcloud
REPO_RAW="https://raw.githubusercontent.com/designx-studio/pocketcloud/main"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { error "$*"; exit 1; }

# ── Rollback stack ────────────────────────────────────────────────────────────
ROLLBACK_CMDS=()
on_error() {
  error "Installation failed. Rolling back..."
  for cmd in "${ROLLBACK_CMDS[@]}"; do
    eval "$cmd" || true
  done
  die "Run with POCKETCLOUD_DOMAIN=<domain> bash and try again."
}
trap on_error ERR

# ── Pre-flight checks ─────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "This script must be run as root."

# OS check
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "$ID" == "ubuntu" ]] || die "Unsupported OS: $ID. Ubuntu 22.04+ required."
  MAJOR_VER="${VERSION_ID%%.*}"
  [[ "$MAJOR_VER" -ge 22 ]] || die "Ubuntu $VERSION_ID is too old. Ubuntu 22.04+ required."
  info "OS: Ubuntu $VERSION_ID ✔"
else
  die "Cannot detect OS. /etc/os-release not found."
fi

# Memory check (require ≥ 1.5 GB)
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
[[ $TOTAL_MEM_KB -ge 1500000 ]] || warn "Low memory: $(( TOTAL_MEM_KB / 1024 )) MB. 2 GB recommended."

# Disk check (require ≥ 15 GB free on /)
FREE_KB=$(df -k / | awk 'NR==2{print $4}')
[[ $FREE_KB -ge 15000000 ]] || warn "Low disk space: $(( FREE_KB / 1024 / 1024 )) GB free. 20 GB recommended."

info "Pre-flight checks passed."

# ── Dependencies ──────────────────────────────────────────────────────────────
info "Installing dependencies..."
apt-get update -qq
apt-get install -y -qq ca-certificates curl openssl gnupg lsb-release

# Install Docker if not present
if ! command -v docker &>/dev/null; then
  info "Installing Docker CE..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
  info "Docker installed ✔"
else
  info "Docker already installed ✔"
fi

# ── Directory structure ───────────────────────────────────────────────────────
info "Creating directory structure at $PREFIX..."
install -d -m 0750 \
  "$PREFIX" \
  "$PREFIX/config" \
  "$PREFIX/storage/redis" \
  "$PREFIX/storage/caddy" \
  "$PREFIX/database" \
  "$PREFIX/backups" \
  "$PREFIX/logs" \
  "$PREFIX/blueprints" \
  "$PREFIX/agent-releases"
ROLLBACK_CMDS+=("rm -rf $PREFIX")

# ── Secret generation ─────────────────────────────────────────────────────────
if [[ ! -f "$PREFIX/.env" ]]; then
  info "Generating cryptographic secrets..."
  PG_PASS=$(openssl rand -hex 32)
  JWT_SECRET=$(openssl rand -hex 64)
  REFRESH_SECRET=$(openssl rand -hex 64)
  ENCRYPTION_KEY=$(openssl rand -base64 32)
  DB_URL="postgresql://pocketcloud:${PG_PASS}@database:5432/pocketcloud?schema=public"

  cat > "$PREFIX/.env" <<EOF
# PocketCloud Control Plane Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# WARNING: Keep this file secure. Never commit to version control.

NODE_ENV=production
PORT=8080
CORS_ORIGIN=https://${POCKETCLOUD_DOMAIN}

POCKETCLOUD_DOMAIN=${POCKETCLOUD_DOMAIN}

POSTGRES_USER=pocketcloud
POSTGRES_PASSWORD=${PG_PASS}
DATABASE_URL=${DB_URL}

JWT_SECRET=${JWT_SECRET}
REFRESH_TOKEN_SECRET=${REFRESH_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
EOF
  chmod 600 "$PREFIX/.env"
  info "Secrets generated and written to $PREFIX/.env ✔"
else
  warn ".env already exists — skipping secret generation."
fi

# ── Fetch deployment files ────────────────────────────────────────────────────
info "Downloading docker-compose.yml and Caddyfile..."
curl --fail --proto '=https' --tlsv1.2 \
  "$REPO_RAW/deploy/docker-compose.yml" \
  -o "$PREFIX/docker-compose.yml"
curl --fail --proto '=https' --tlsv1.2 \
  "$REPO_RAW/deploy/Caddyfile" \
  -o "$PREFIX/Caddyfile"
info "Deployment files downloaded ✔"

# ── Start services ────────────────────────────────────────────────────────────
info "Starting PocketCloud services..."
cd "$PREFIX"
docker compose --env-file .env pull --quiet
docker compose --env-file .env up -d

# Wait for database to be healthy
info "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if docker compose exec -T database pg_isready -U pocketcloud -d pocketcloud &>/dev/null; then
    info "PostgreSQL is ready ✔"
    break
  fi
  [[ $i -eq 30 ]] && die "PostgreSQL did not become ready in 60 seconds."
  sleep 2
done

# Run database migrations
info "Running Prisma database migrations..."
docker compose exec -T api npx prisma migrate deploy
info "Migrations applied ✔"

# ── Health check ──────────────────────────────────────────────────────────────
info "Waiting for API to become healthy..."
for i in {1..30}; do
  if curl -fsS "http://localhost:8080/health" &>/dev/null; then
    info "API is healthy ✔"
    break
  fi
  [[ $i -eq 30 ]] && { docker compose ps; die "API health check failed."; }
  sleep 2
done

# ── Summary ───────────────────────────────────────────────────────────────────
trap - ERR

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  PocketCloud installed successfully!               ${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo ""
echo "  Dashboard: https://${POCKETCLOUD_DOMAIN}"
echo "  API Docs:  https://${POCKETCLOUD_DOMAIN}/docs"
echo "  Secrets:   $PREFIX/.env"
echo ""
echo "  Services:"
docker compose ps --format "  {.Name}\t{.Status}"
echo ""
echo -e "${YELLOW}IMPORTANT:${NC} Register your first account at https://${POCKETCLOUD_DOMAIN}"
echo ""
