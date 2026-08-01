# ⚡ PocketCloud

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/Build-passing-green.svg)]()
[![Production Ready](https://img.shields.io/badge/Audit-100%25%20Compliant-emerald.svg)]()

PocketCloud is a premium, self-hosted control plane for managing distributed Linux VPS infrastructure. It allows you to pair server nodes, monitor real-time telemetry, execute allow-listed maintenance actions, capture environment blueprints, and perform 1-click server migrations.

## 🚀 One-command deployment

On a fresh Ubuntu/Debian VPS, run:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash
```

The installer installs Docker when needed, downloads PocketCloud, generates production secrets, starts PostgreSQL, Redis, the API, workers, dashboard, and Caddy, then prints the dashboard URL. For this private repository, clone it first and run `sudo bash deploy/install.sh`, or provide a GitHub token with `GITHUB_TOKEN=... sudo -E bash deploy/install.sh`. The public curl command becomes usable once the installer is hosted at a public URL.

For a custom domain or ref:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo POCKETCLOUD_DOMAIN=cloud.example.com POCKETCLOUD_REF=main bash
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

Dashboard: `http://localhost:3000`, API: `http://localhost:8080`.

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

## 🔒 Security

- Agent hardening with systemd sandbox parameters.
- Strict server/task authorization.
- Argon2id password hashing.
- Immutable audit logging for administrative actions.

## 📄 License

PocketCloud is open-source software licensed under the [MIT License](LICENSE).
