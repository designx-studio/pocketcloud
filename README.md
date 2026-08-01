# ⚡ PocketCloud

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/Build-passing-green.svg)]()
[![Health Checks](https://img.shields.io/badge/Health%20Checks-Enabled-success.svg)]()

PocketCloud is a premium, self-hosted control plane for managing distributed Linux VPS infrastructure. It allows you to pair server nodes, monitor real-time telemetry, execute allow-listed maintenance actions, capture environment blueprints, and perform 1-click server migrations.

## 🚀 One-command deployment

On a fresh Ubuntu/Debian VPS, run:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash
```

The installer installs Docker when needed, downloads PocketCloud, asks once for your **PocketCloud Domain**, writes the canonical config at `/opt/pocketcloud/.env`, generates production secrets and public URLs, validates configuration, then starts PostgreSQL, Redis, the API, workers, dashboard, and Caddy.

From a single domain such as `cloud.example.com` the installer derives:

```env
APP_URL=https://cloud.example.com
API_URL=https://cloud.example.com/api
WS_URL=wss://cloud.example.com/ws
CORS_ORIGIN=https://cloud.example.com
```

Production never sets `CORS_ORIGIN=*` (the API refuses to start if it does). For this private repository, clone it first and run `sudo POCKETCLOUD_DOMAIN=cloud.example.com bash deploy/install.sh`, or provide a GitHub token with `GITHUB_TOKEN=... sudo -E bash deploy/install.sh`.

For a custom domain or ref:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh \
  | sudo POCKETCLOUD_DOMAIN=cloud.example.com POCKETCLOUD_REF=main bash
```

## 🚀 Key Features

- 🖥️ **Multi-VPS Fleet Management**: Pair any Linux VPS node with an outbound systemd agent.
- 📊 **Real-time Telemetry & Metrics**: Monitor CPU, memory, disk usage, uptime, and load in a unified dashboard.
- 🛠️ **Secure Dispatch Pipeline**: Execute maintenance actions via an encrypted, agent-polled connection.
- 📦 **Declarative Blueprints**: Capture complete environment manifests with automatic secret redaction.
- ⚡ **1-Click Migration**: Replicate or restore a blueprint onto any online server node instantly.
- 🧠 **AI Diagnostics & Sanitizer**: Scan logs and recommend solutions for infrastructure issues.
- 💾 **Disaster Recovery**: Export and import complete control plane states as portable JSON archives.

## ⚙️ Local development

```bash
cp .env.example .env
npm install
npm run db:push
npm run dev
```

Development allows wildcard CORS:

```env
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:8080
WS_URL=ws://localhost:8080
CORS_ORIGIN=*
```

Dashboard: `http://localhost:3000`, API: `http://localhost:8080`.

Production configuration always lives at `/opt/pocketcloud/.env` (see [docs/configuration.md](docs/configuration.md) and [docs/installation.md](docs/installation.md)).

## Running tests & verification

```bash
npm run lint
npm run build
npm run test
```

## 📁 Repository Structure

- `apps/api`: Fastify API, workers, database models, and agent communication.
- `apps/web` and root `index.html`: PocketCloud dashboard client.
- `agent`: Linux agent and systemd installer.
- `packages/blueprint`: Environment validator, parser, and secret sanitizer.
- `deploy`: Docker Compose, Caddy, and production installer.
- `docs`: Architecture, API, security, and blueprint documentation.

## 🔧 Production Verification

After installation, verify all services are healthy:

```bash
cd /opt/pocketcloud
docker compose -f deploy/docker-compose.yml ps
```

Expected output should show all services as "healthy" or "running":

- database (PostgreSQL)
- redis
- api
- settings
- worker
- scheduler
- task-engine
- agent-registry
- dashboard
- caddy

## � Production Deployment

**Official Installation Method**:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash
```

This is the canonical installer. All other installation methods are deprecated.

**Verification**:

After installation, verify all services are healthy:

```bash
cd /opt/pocketcloud
docker compose -f deploy/docker-compose.yml ps
```

Expected output should show all services as "healthy" or "running".

## �🔒 Security

- Agent hardening with systemd sandbox parameters.
- Strict server/task authorization.
- Argon2id password hashing.
- Immutable audit logging for administrative actions.

## 📄 License

PocketCloud is open-source software licensed under the [MIT License](LICENSE).
