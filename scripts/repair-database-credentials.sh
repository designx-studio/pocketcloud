#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${POCKETCLOUD_INSTALL_DIR:-/opt/pocketcloud}"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"

fail() { echo "[pocketcloud] ERROR: $*" >&2; exit 1; }
[[ "$EUID" -eq 0 ]] || fail "Run as root"
[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
command -v docker >/dev/null 2>&1 || fail "Docker is required"

read_env() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2-; }
DB_USER="$(read_env POSTGRES_USER)"
DB_NAME="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
DB_USER="${DB_USER:-pocketcloud}"
DB_NAME="${DB_NAME:-pocketcloud}"
DB_PASSWORD="$(read_env POSTGRES_PASSWORD)"
[[ -n "$DB_PASSWORD" ]] || fail "POSTGRES_PASSWORD is missing from $ENV_FILE"

cd "$INSTALL_DIR"

echo "[pocketcloud] Waiting for PostgreSQL..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d database
for _ in {1..30}; do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T database pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then break; fi
  sleep 2
done

# Use the container's local postgres OS account. This works even when the
# persisted cluster password no longer matches the current .env file.
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T --user postgres database \
  psql -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE \"$DB_USER\" WITH PASSWORD '$DB_PASSWORD';" \
  -c "ALTER DATABASE \"$DB_NAME\" OWNER TO \"$DB_USER\";"

echo "[pocketcloud] Database credentials synchronized with $ENV_FILE"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate api settings worker scheduler task-engine agent-registry caddy
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
