# PocketCloud Installation Guide

> Self-hosted Linux VPS management platform. Minimum requirements: Ubuntu 22.04+, 2 GB RAM, 20 GB disk, Docker.

## One-Line Control Plane Install

```bash
curl -fsSL https://install.pocketcloud.dev | bash
```

What this does:
1. Validates Ubuntu 22.04+
2. Installs Docker and Docker Compose plugin
3. Generates cryptographically random secrets for JWT, encryption, and Postgres
4. Writes `/opt/pocketcloud/.env` with all configuration
5. Pulls `docker-compose.yml` and `Caddyfile` from GitHub
6. Starts all services: database, redis, api, workers, dashboard, caddy
7. Runs Prisma migrations (`prisma migrate deploy`)
8. Health-checks every service before reporting success

## Custom Domain

Set the environment variable before running the installer:

```bash
export POCKETCLOUD_DOMAIN=cloud.yourcompany.com
curl -fsSL https://install.pocketcloud.dev | bash
```

Caddy will automatically obtain and renew a Let's Encrypt TLS certificate for that domain.

## Local Development

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL to a local PostgreSQL instance
npm install
cd apps/api && npx prisma migrate dev && cd ../..
npm run dev
```

The frontend is served from the project root (use `npx serve .` or VS Code Live Server).
The API runs on port 8080 via `tsx watch`.

## Directory Structure

| Path | Purpose |
|---|---|
| `/opt/pocketcloud/.env` | Runtime secrets — never commit this |
| `/opt/pocketcloud/docker-compose.yml` | Service orchestration |
| `/opt/pocketcloud/Caddyfile` | Reverse proxy + TLS config |
| `/opt/pocketcloud/storage/` | Persistent volumes (Redis, Caddy certs) |
| `/opt/pocketcloud/database/` | PostgreSQL data directory |
| `/opt/pocketcloud/backups/` | Control plane backup archives |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `pocketcloud` | PostgreSQL username |
| `POSTGRES_PASSWORD` | (generated) | PostgreSQL password |
| `JWT_SECRET` | (generated) | 512-bit HMAC secret for access tokens |
| `REFRESH_TOKEN_SECRET` | (generated) | HMAC secret for refresh tokens |
| `ENCRYPTION_KEY` | (generated) | 256-bit AES encryption key |
| `POCKETCLOUD_DOMAIN` | `localhost` | Public domain for Caddy TLS |
| `DATABASE_URL` | (computed) | Full Postgres connection string |
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `8080` | API listen port (internal) |

## Upgrade

```bash
cd /opt/pocketcloud
docker compose pull
docker compose up -d --force-recreate
docker compose exec api npx prisma migrate deploy
```

## Uninstall

```bash
cd /opt/pocketcloud
docker compose down -v
rm -rf /opt/pocketcloud
```
