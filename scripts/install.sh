#!/usr/bin/env bash
set -Eeuo pipefail
PREFIX=/opt/pocketcloud
REPO_OWNER="designx-studio"; REPO_NAME="pocketcloud"; REPO_REF="main"; TMP_ROOT=""
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info(){ echo -e "${GREEN}[INFO]${NC}  $*"; }; warn(){ echo -e "${YELLOW}[WARN]${NC}  $*"; }; die(){ echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }; cleanup(){ [[ -n "${TMP_ROOT:-}" && -d "$TMP_ROOT" ]]&&rm -rf "$TMP_ROOT"; }; trap cleanup EXIT
[[ $EUID -eq 0 ]]||die "Run as root: curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/scripts/install.sh | sudo bash"
SOURCE_ROOT="${POCKETCLOUD_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null&&pwd)}"
if [[ ! -f "$SOURCE_ROOT/deploy/docker-compose.yml" ]];then TMP_ROOT=$(mktemp -d); ARCHIVE="$TMP_ROOT/pocketcloud.tar.gz"; info "Downloading PocketCloud release source..."; curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/refs/heads/${REPO_REF}" -o "$ARCHIVE"||die "Could not download PocketCloud source archive."; tar -xzf "$ARCHIVE" -C "$TMP_ROOT"; SOURCE_ROOT=$(find "$TMP_ROOT" -mindepth 1 -maxdepth 1 -type d -name "${REPO_NAME}-*"|head -n1);fi
[[ -f "$SOURCE_ROOT/deploy/docker-compose.yml" ]]||die "Missing deploy/docker-compose.yml under $SOURCE_ROOT"; [[ -f "$SOURCE_ROOT/deploy/Dockerfile.api" ]]||die "Missing deploy/Dockerfile.api under $SOURCE_ROOT"; [[ -f "$SOURCE_ROOT/package.json" ]]||die "Missing repository package.json under $SOURCE_ROOT"
POCKETCLOUD_DOMAIN="${POCKETCLOUD_DOMAIN:-}"; if [[ -z "$POCKETCLOUD_DOMAIN"&&-t 0&&-r /dev/tty ]];then read -r -p "PocketCloud domain or public IP [localhost]: " POCKETCLOUD_DOMAIN </dev/tty;fi; POCKETCLOUD_DOMAIN="${POCKETCLOUD_DOMAIN:-localhost}"; [[ "$POCKETCLOUD_DOMAIN" == localhost ]]&&warn "Using localhost. Set POCKETCLOUD_DOMAIN to a DNS name for trusted HTTPS."
source /etc/os-release; [[ "$ID" == ubuntu ]]||die "Unsupported OS: $ID. Ubuntu 22.04+ required."; [[ "${VERSION_ID%%.*}" -ge 22 ]]||die "Ubuntu $VERSION_ID is too old."; info "OS: Ubuntu $VERSION_ID ✔"
TOTAL_MEM_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo); [[ $TOTAL_MEM_KB -ge 1500000 ]]||warn "Low memory."; FREE_KB=$(df -k /|awk 'NR==2{print $4}'); [[ $FREE_KB -ge 15000000 ]]||warn "Low disk space."
apt-get update -qq; apt-get install -y -qq ca-certificates curl openssl gnupg lsb-release rsync tar
if ! command -v docker >/dev/null 2>&1;then install -m0755 -d /etc/apt/keyrings; curl --fail --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg|gpg --dearmor -o /etc/apt/keyrings/docker.gpg; chmod a+r /etc/apt/keyrings/docker.gpg; echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable">/etc/apt/sources.list.d/docker.list; apt-get update -qq; apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin; systemctl enable --now docker;fi
command -v docker >/dev/null||die "Docker installation failed."; docker compose version >/dev/null 2>&1||die "Docker Compose plugin is missing."
install -d -m0750 "$PREFIX"; rsync -a --delete --exclude '.git' --exclude '.env' "$SOURCE_ROOT/" "$PREFIX/"; install -d -m0750 "$PREFIX/config" "$PREFIX/storage/redis" "$PREFIX/storage/caddy" "$PREFIX/database" "$PREFIX/backups" "$PREFIX/logs" "$PREFIX/blueprints" "$PREFIX/agent-releases"
if [[ ! -f "$PREFIX/.env" ]];then PG_PASS=$(openssl rand -hex 32); JWT_SECRET=$(openssl rand -hex 64); REFRESH_SECRET=$(openssl rand -hex 64); ENCRYPTION_KEY=$(openssl rand -base64 32|tr -d '\n'); umask 077; cat >"$PREFIX/.env" <<EOF
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
chmod 600 "$PREFIX/.env"; info "Generated production configuration and secrets.";fi
cd "$PREFIX"; COMPOSE_FILE="$PREFIX/deploy/docker-compose.yml"; ln -sfn ../.env "$PREFIX/deploy/.env"; COMPOSE=(docker compose --project-directory "$PREFIX" --file "$COMPOSE_FILE" --env-file "$PREFIX/.env"); "${COMPOSE[@]}" config >/dev/null||die "Compose configuration validation failed."; "${COMPOSE[@]}" up -d --build
for i in {1..30};do "${COMPOSE[@]}" exec -T database pg_isready -U pocketcloud -d pocketcloud >/dev/null 2>&1&&break; [[ $i -eq 30 ]]&&die "PostgreSQL did not become ready."; sleep 2;done
"${COMPOSE[@]}" exec -T api npx prisma migrate deploy
for service in api settings worker scheduler task-engine agent-registry dashboard;do state=$("${COMPOSE[@]}" ps --status running --services|grep -Fx "$service"||true); [[ "$state" == "$service" ]]||die "Service $service is not running.";done
for i in {1..30};do "${COMPOSE[@]}" exec -T api wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1&&break; [[ $i -eq 30 ]]&&die "API health check failed."; sleep 2;done
"${COMPOSE[@]}" exec -T settings wget -qO- http://127.0.0.1:8082/health >/dev/null 2>&1||die "Settings service health check failed."
cat <<EOF

${GREEN}PocketCloud installed successfully.${NC}
Dashboard: https://${POCKETCLOUD_DOMAIN}
API Docs: https://${POCKETCLOUD_DOMAIN}/docs

Open the dashboard and create your administrator account to continue.
Then open Settings > Configuration to manage runtime settings without SSH.
EOF
"${COMPOSE[@]}" ps