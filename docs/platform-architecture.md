# PocketCloud — Platform Architecture & What It Is

## 1. What Is PocketCloud?

**PocketCloud is a distributed Linux infrastructure layer built from any VPS.**

It turns scattered Linux servers — free tier instances, cloud VPS providers, dedicated
servers, and home labs — into one self-hosted infrastructure platform.

The core distinction from ordinary server management tools:

```
Portainer / Cockpit / CasaOS:
  "Manage this server."

PocketCloud:
  "Combine many servers into one resilient infrastructure."
```

The mental model:

```
        Free VPS        Low Cost VPS       Home Lab
            │               │                │
            ▼               ▼                ▼

        Oracle Cloud    Hetzner        Raspberry Pi

                    \       |       /

                 PocketCloud Network

                         │

        Unified Infrastructure Layer

                         │

       Apps | Services | Deployments | Backups
```

**The product is not the dashboard.** The dashboard is the window into the distributed
system. The product is the infrastructure layer itself.

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        POCKETCLOUD CONTROL PLANE                     │
│                                                                       │
│  ┌──────────┐    ┌─────────────────────────────────────────────┐    │
│  │  Caddy   │    │              CONTAINER CLUSTER               │    │
│  │ Reverse  │───>│  ┌──────────┐  ┌───────────┐  ┌─────────┐  │    │
│  │  Proxy   │    │  │  API     │  │ Dashboard │  │  Redis  │  │    │
│  │ Port 443 │    │  │ :8080    │  │  :3000    │  │  :6379  │  │    │
│  └──────────┘    │  └────┬─────┘  └───────────┘  └────┬────┘  │    │
│                  │       │                              │        │    │
│                  │  ┌────▼──────────────────────────────┐       │    │
│                  │  │          PostgreSQL :5432           │       │    │
│                  │  │  Users, Sessions, Servers, Agents  │       │    │
│                  │  │  Tasks, Blueprints, HealthMetrics   │       │    │
│                  │  └────────────────────────────────────┘       │    │
│                  │                                               │    │
│                  │  ┌──────────┐  ┌────────────┐  ┌─────────┐  │    │
│                  │  │  Worker  │  │ Scheduler  │  │ Task    │  │    │
│                  │  │  (queue) │  │ (cron)     │  │ Engine  │  │    │
│                  │  └──────────┘  └────────────┘  └─────────┘  │    │
│                  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ HTTPS (outbound from agent)
                                    │
         ┌──────────┬───────────────┼───────────────┐
         │          │               │               │
  ┌──────┴───┐ ┌────┴─────┐ ┌──────┴───┐ ┌────────┴─┐
  │ VPS #1   │ │ VPS #2   │ │ VPS #3   │ │  VPS #N  │
  │ Oracle   │ │ Hetzner  │ │ DO       │ │  Vultr   │
  │ Agent    │ │ Agent    │ │ Agent    │ │  Agent   │
  └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### Control Plane Components

| Component | Role |
|---|---|
| **Caddy** | Reverse proxy on port 443, automatic HTTPS via Let's Encrypt |
| **API (`:8080`)** | Fastify REST API — auth, servers, agents, tasks, blueprints, telemetry |
| **Dashboard (`:3000`)** | Vanilla HTML/CSS/JS SPA served to operators (our landing page + dashboard) |
| **Redis (`:6379`)** | Task queue / transient coordination |
| **PostgreSQL (`:5432`)** | Primary persistence: users, sessions, servers, agents, tasks, blueprints, metrics |
| **Worker** | Processes queued tasks and transitions statuses |
| **Scheduler** | Cron — marks offline nodes, prunes old metrics, auto-fails stuck tasks |
| **Task Engine** | Core task lifecycle state machine |

### Managed Node (Agent)

Each managed Linux VPS runs a single **statically compiled Go binary** (`pocketcloud-agent`).
The agent communicates **outbound only** over HTTPS/TLS — no inbound ports are ever opened.

---

## 3. Core Concepts

### 3.1 Servers Are Replaceable. Infrastructure Is Not.

PocketCloud separates your environment from the machine running it. This is achieved
through **portable blueprints** — declarative specs that describe packages, services,
Docker containers, cron jobs, and environment variables.

This means:

- A free Oracle tier can expire.
- Credits run out at DigitalOcean.
- A home lab motherboard dies.

**The application keeps running because the infrastructure definition survives.**

### 3.2 The Outbound Agent Model

Every node runs an agent that connects **outward** to the control plane. This removes
the need for:

- Inbound firewall rules
- SSH key management across boxes
- A public-facing port on each VPS

The control plane never needs to reach into the node — the node reaches out.

### 3.3 Portable Blueprints

When you capture a blueprint, PocketCloud records:

```yaml
version: "1.1"
name: web-stack
os: ubuntu-24.04
packages:
  - nginx
  - docker
  - nodejs
services:
  - nginx
  - postgres
ports:
  - 80
  - 443
```

Secret values are **irreversibly redacted** (`sanitizeEnvironment()`) before the
blueprint is stored. The operator manually re-enters secrets during restoration.

---

## 4. Data Flow

### 4.1 Agent Registration

```
1. Operator adds server in dashboard
2. API creates Server + BootstrapToken (1h TTL, single-use)
3. Operator runs install command on VPS over SSH
4. Agent binary downloads and installs
5. Agent calls POST /api/v1/agent/register with bootstrap token
6. API validates token, creates Agent record, returns credential token
7. Bootstrap token marked used; Server status set to ONLINE
```

### 4.2 Telemetry Collection

```
1. Agent reads /proc/stat, /proc/meminfo, /proc/loadavg, /proc/uptime
2. Agent posts POST /api/v1/agent/heartbeat every 10 seconds
3. API writes HealthMetric + Heartbeat records to PostgreSQL
4. Scheduler marks server OFFLINE if lastSeenAt > 30 seconds ago
```

### 4.3 Task Execution

```
1. Operator dispatches task from dashboard
2. API creates Task with status QUEUED
3. Worker process transitions task to RUNNING
4. Agent polls GET /api/v1/agent/tasks/pending every 10 seconds
5. Agent executes task, streams logs via POST /api/v1/tasks/:id/logs
6. Agent calls POST /api/v1/tasks/:id/complete when finished
7. Task Engine auto-fails tasks stuck >10 minutes or on OFFLINE servers
```

---

## 5. Agent Architecture

```
VPS Agent                          Control Plane API
──────────                         ─────────────────
  │                                       │
  ├─ POST /api/v1/agent/register ────────>│ (bootstrap token → credential token)
  │                                       │
  ├─ POST /api/v1/agent/heartbeat ───────>│ (every 10s: CPU, MEM, DISK, LOAD)
  │                                       │
  ├─ GET  /api/v1/agent/tasks/pending ──>│ (every 10s: poll for queued tasks)
  │  <── Task payload ────────────────────┤
  │                                       │
  ├─ POST /api/v1/tasks/:id/logs ────────>│ (stream execution logs)
  │                                       │
  └─ POST /api/v1/tasks/:id/complete ───>│ (COMPLETED | FAILED)
```

### Supported Platforms

| Platform | Binary |
|---|---|
| Linux x86_64 (amd64) | `pocketcloud-agent-linux-x86_64` |
| Linux ARM64 (aarch64) | `pocketcloud-agent-linux-aarch64` |
| Linux ARM v7 | `pocketcloud-agent-linux-armv7l` |

### Allow-Listed Task Types

| Task Type | What It Does |
|---|---|
| `update_packages` | `apt-get update && apt-get upgrade -y` |
| `install_docker` | Installs Docker CE via official GPG key |
| `restart_service` | `systemctl restart <service>` |
| `collect_logs` | `journalctl -n 100` → streams to API |
| `update_agent` | Downloads new binary from control plane, hot-swaps |
| `reboot` | Schedules `reboot` in 5 seconds |
| `shutdown` | Schedules `poweroff` in 5 seconds |
| `restore_blueprint` | Applies declarative blueprint manifest |

---

## 6. Blueprint System

### 6.1 Structure

```json
{
  "name": "web-api-stack",
  "os": "ubuntu-24.04",
  "provider": "hetzner",
  "environment": "production",
  "captured_at": "2025-01-15T10:00:00Z",
  "packages": ["docker.io", "docker-compose-plugin", "nginx", "curl", "git"],
  "services": [
    { "name": "nginx",  "enabled": true, "running": true },
    { "name": "docker", "enabled": true, "running": true }
  ],
  "docker": {
    "compose_files": ["/opt/app/docker-compose.yml"],
    "running_containers": ["api", "worker", "postgres", "redis"]
  },
  "env_vars": {
    "NODE_ENV": "production",
    "DATABASE_URL": "[REDACTED]",
    "PORT": "8080"
  },
  "cron_jobs": [
    { "schedule": "0 3 * * *", "command": "certbot renew" }
  ]
}
```

### 6.2 Secret Redaction

`sanitizeEnvironment()` automatically redacts keys containing:
`password`, `secret`, `token`, `credential`, `api_key`, `private_key`, `auth`, `passphrase`.

All values become `"[REDACTED]"`. **This is irreversible** — secrets are re-entered during restoration.

### 6.3 Compatibility Checks

`validateCompatibility()` checks:
- OS family match (Ubuntu → Ubuntu, Debian → Debian)
- Architecture match (x86_64 vs aarch64)
- Major version match (Ubuntu 22 blueprint → Ubuntu 24 target = warning, not block)

### 6.4 Versioning

Every re-capture creates a new `BlueprintVersion` with:
- Full manifest (JSON)
- SHA-256 checksum
- Creation timestamp

Previous versions are preserved and can be restored independently.

### 6.5 Restoration Process

1. Operator selects blueprint + target server
2. `POST /api/v1/blueprints/restore` creates a `restore_blueprint` task
3. Agent executes the task payload (packages, services, docker)
4. Logs stream back in real-time via the task log API
5. Operator verifies via the Tasks tab

---

## 7. Database Schema

### Models (14)

| Model | Purpose |
|---|---|
| `User` | Operator accounts with roles: OWNER, ADMIN, OPERATOR, VIEWER |
| `Session` | Refresh token sessions |
| `Server` | Registered VPS nodes |
| `Agent` | Paired agent records (one per server) |
| `BootstrapToken` | Single-use install tokens (1h TTL) |
| `Task` | Dispatched maintenance tasks |
| `TaskLog` | Append-only task execution log entries |
| `Blueprint` | Saved environment specifications |
| `BlueprintVersion` | Versioned blueprint manifests with checksums |
| `HealthMetric` | Time-series CPU/MEM/DISK/LOAD data |
| `Heartbeat` | Raw JSON heartbeat payloads |
| `AuditLog` | Immutable operator action log |
| `Setting` | Runtime key-value configuration |
| `Backup` | Backup archive registry |

---

## 8. Security Architecture

- All secrets generated with `crypto.randomBytes(32)` (256-bit entropy)
- Passwords hashed with **Argon2id** (memory: 64MB, time: 3, parallelism: 4)
- JWT access tokens: HMAC-SHA256, 15-minute TTL
- Refresh tokens: SHA-256 hashed before storage, 30-day TTL
- Agent credentials: SHA-256 hashed before storage
- Bootstrap tokens: single-use, 1-hour TTL
- Rate limiting: 300 req/min per IP
- CORS: configurable via `CORS_ORIGIN` env (explicit `https://` origin in production)
- Helmet.js: security headers on all responses
- Agent: unprivileged systemd service with:
  - `NoNewPrivileges=true`
  - `ProtectSystem=strict`
  - `ProtectHome=true`

---

## 9. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Database | PostgreSQL | ACID, JSON support, full Prisma support |
| ORM | Prisma | Type-safe, migration tooling, JS/TS |
| API Framework | Fastify | Fastest Node.js HTTP server, schema validation |
| Auth | Argon2id + JOSE JWT | Memory-hard hashing, RFC 7518 tokens |
| Agent Language | Go | Single binary, no runtime deps, cross-compile |
| Reverse Proxy | Caddy | Automatic HTTPS, zero-config Let's Encrypt |
| CSS | Vanilla CSS | No build step for frontend, full control |
| Icons | Lucide | MIT license, tree-shakeable, consistent design |

---

## 10. Scalability

Designed to manage hundreds of VPS nodes from a single control plane instance:

- PostgreSQL indexed by `(serverId, collectedAt)` for metric queries
- 15-second frontend polling (not websockets) keeps load minimal
- Health metrics auto-pruned after 30 days
- Heartbeat records auto-pruned after 7 days
- Worker concurrency configurable via `WORKER_CONCURRENCY`

---

## 11. The Migration Story

The entire value proposition in 10 seconds:

```
Oracle VPS expires
        ↓
PocketCloud detects replacement needed
        ↓
New Hetzner VPS connected
        ↓
Blueprint restored
        ↓
Application running again
```

Your VPS can change. **Your infrastructure stays.**

---

## 12. Deployment

Control plane deploys via Docker Compose:

```
deploy/
├── docker-compose.yml     # caddy + api + dashboard + postgres + redis + worker
├── Dockerfile.api         # API image build
├── Caddyfile              # automatic HTTPS config
├── install.sh             # one-command installer on fresh Ubuntu VPS
└── entrypoint.sh          # API container entrypoint
```

One-line installation:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash