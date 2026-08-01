# PocketCloud Installation Guide

> Self-hosted Linux VPS management platform. Minimum requirements: Ubuntu 22.04+, 2 GB RAM, 20 GB disk, Docker.

## One-Line Control Plane Install

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash
```

What this does:
1. Validates Ubuntu 22.04+ (full installer) or installs Docker as needed
2. Installs Docker and Docker Compose plugin when missing
3. Asks once for **PocketCloud Domain** (or reads `POCKETCLOUD_DOMAIN`)
4. Generates cryptographically random secrets for JWT, encryption, and Postgres
5. Writes the **canonical** environment file at `/opt/pocketcloud/.env`
6. Derives all public URLs from the domain automatically:
   - `APP_URL=https://<domain>`
   - `API_URL=https://<domain>/api`
   - `WS_URL=wss://<domain>/ws`
   - `CORS_ORIGIN=https://<domain>`
7. Validates required variables and rejects invalid production CORS (`*`, `http://`, `localhost`)
8. Starts all services: database, redis, api, workers, dashboard, caddy
9. Runs Prisma migrations (`prisma migrate deploy`)
10. Health-checks every service before reporting success

## Custom Domain

Set the domain once — never enter API/WS/CORS URLs separately:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh \
  | sudo POCKETCLOUD_DOMAIN=cloud.example.com bash
```

Caddy will automatically obtain and renew a Let's Encrypt TLS certificate for that domain when DNS points at the server.

### Generated production configuration

```env
NODE_ENV=production
APP_URL=https://cloud.example.com
API_URL=https://cloud.example.com/api
WS_URL=wss://cloud.example.com/ws
CORS_ORIGIN=https://cloud.example.com
```

`CORS_ORIGIN=*` is **never** written in production. The API refuses to start if it is.

## Local Development

```bash
cp .env.example .env
# Development defaults allow CORS_ORIGIN=*
npm install
cd apps/api && npx prisma migrate dev && cd ../..
npm run dev
```

Development example:

```env
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:8080
WS_URL=ws://localhost:8080
CORS_ORIGIN=*
```

The frontend is served from the project root (use `npx serve .` or VS Code Live Server).
The API runs on port 8080 via `tsx watch`.

## Directory Structure

| Path | Purpose |
|---|---|
| `/opt/pocketcloud/.env` | **Canonical** runtime secrets — never commit this |
| `/opt/pocketcloud/deploy/docker-compose.yml` | Service orchestration (`env_file: ../.env`) |
| `/opt/pocketcloud/deploy/Caddyfile` | Reverse proxy + TLS config |
| `/opt/pocketcloud/storage/` | Persistent volumes (Redis, Caddy certs) |
| `/opt/pocketcloud/database/` | PostgreSQL data directory |
| `/opt/pocketcloud/backups/` | Control plane backup archives |

Every component reads the same file: **`/opt/pocketcloud/.env`**.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_URL` | (from domain) | Public dashboard origin (`https://…`) |
| `API_URL` | (from domain) | Public API base (`https://…/api`) |
| `WS_URL` | (from domain) | Public WebSocket base (`wss://…/ws`) |
| `CORS_ORIGIN` | (from domain) | Explicit browser origin — never `*` in production |
| `POSTGRES_USER` | `pocketcloud` | PostgreSQL username |
| `POSTGRES_PASSWORD` | (generated) | PostgreSQL password |
| `JWT_SECRET` | (generated) | 512-bit HMAC secret for access tokens |
| `REFRESH_TOKEN_SECRET` | (generated) | HMAC secret for refresh tokens |
| `ENCRYPTION_KEY` | (generated) | 256-bit AES encryption key |
| `POCKETCLOUD_DOMAIN` | (required) | Public domain for Caddy TLS |
| `DATABASE_URL` | (computed) | Full Postgres connection string |
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `8080` | API listen port (internal) |

## Upgrade

```bash
cd /opt/pocketcloud
docker compose -f deploy/docker-compose.yml --env-file /opt/pocketcloud/.env pull
docker compose -f deploy/docker-compose.yml --env-file /opt/pocketcloud/.env up -d --force-recreate
docker compose -f deploy/docker-compose.yml --env-file /opt/pocketcloud/.env exec api npx prisma migrate deploy
```

## Uninstall

```bash
cd /opt/pocketcloud
docker compose -f deploy/docker-compose.yml --env-file /opt/pocketcloud/.env down -v
rm -rf /opt/pocketcloud
```
