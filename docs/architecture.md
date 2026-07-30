# PocketCloud Architecture

## System Overview

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

## Data Flow

### Agent Registration
1. Operator adds server in dashboard → API creates server + bootstrap token (1h TTL, single-use)
2. Operator runs install command on VPS → Agent binary downloads and installs
3. Agent calls `POST /api/v1/agent/register` with bootstrap token
4. API validates token, creates Agent record, returns credential token
5. Bootstrap token marked as used; Server status set to ONLINE

### Telemetry Collection
1. Agent collects metrics from `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime`
2. Agent posts to `POST /api/v1/agent/heartbeat` every 10 seconds
3. API writes `HealthMetric` + `Heartbeat` records to PostgreSQL
4. Scheduler marks server OFFLINE if `lastSeenAt` > 30 seconds ago

### Task Execution
1. Operator dispatches task from dashboard
2. API creates `Task` with status `QUEUED`
3. Worker process transitions task to `RUNNING`
4. Agent polls `GET /api/v1/agent/tasks/pending` every 10 seconds
5. Agent executes task, streams logs via `POST /api/v1/tasks/:id/logs`
6. Agent calls `POST /api/v1/tasks/:id/complete` when finished
7. Task Engine auto-fails tasks stuck >10 minutes or on OFFLINE servers

## Technology Decisions

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

## Database Schema

13 Prisma models:

- `User` — operator accounts with role (OWNER, ADMIN, OPERATOR, VIEWER)
- `Session` — refresh token sessions
- `Server` — registered VPS nodes
- `Agent` — paired agent records (one per server)
- `BootstrapToken` — single-use install tokens (1h TTL)
- `Task` — dispatched maintenance tasks
- `TaskLog` — append-only task execution log entries
- `Blueprint` — saved environment specifications
- `BlueprintVersion` — versioned blueprint manifests with checksums
- `HealthMetric` — time-series CPU/MEM/DISK/LOAD data
- `Heartbeat` — raw JSON heartbeat payloads
- `AuditLog` — immutable operator action log
- `Setting` — runtime key-value configuration
- `Backup` — backup archive registry

## Security Architecture

- All secrets generated with `crypto.randomBytes(32)` (256-bit entropy)
- Passwords hashed with Argon2id (memory: 64MB, time: 3, parallelism: 4)
- JWT access tokens: HMAC-SHA256, 15-minute TTL
- Refresh tokens: SHA-256 hashed before storage, 30-day TTL
- Agent credentials: SHA-256 hashed before storage
- Bootstrap tokens: single-use, 1-hour TTL
- Rate limiting: 300 req/min per IP
- CORS: configurable via `CORS_ORIGIN` env
- Helmet.js: security headers on all responses
- Agent: unprivileged systemd service with `NoNewPrivileges=true`

## Scalability

The control plane is designed to manage hundreds of VPS nodes from a single instance:

- PostgreSQL indexed by `(serverId, collectedAt)` for metric queries
- 15-second frontend polling (not websockets) keeps load minimal
- Health metrics auto-pruned after 30 days
- Heartbeat records auto-pruned after 7 days
- Worker concurrency configurable via `WORKER_CONCURRENCY`
