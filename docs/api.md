# PocketCloud API Reference

Interactive API docs are available at: `https://<your-domain>/docs` (Swagger UI, powered by `@fastify/swagger-ui`). They are served only when `ENABLE_API_DOCS=true`, which is the default in development and off in production.

## Base URL

```
https://<your-domain>/api/v1
```

## Authentication

Most endpoints require a valid JWT access token:

```http
Authorization: Bearer <accessToken>
```

Access tokens expire in **15 minutes**. Obtain a new one via `POST /api/v1/auth/login` or by refreshing via the `refresh_token` cookie.

---

## Auth Endpoints

### `POST /api/v1/auth/register`
Register an operator account.

The first account on a fresh control plane is created unauthenticated and becomes the `OWNER`. Afterwards the endpoint requires an `OWNER` access token (`403 registration_closed` otherwise) and creates a `VIEWER` unless `role` is supplied.

**Body:**
```json
{ "email": "admin@example.com", "password": "min8chars", "role": "VIEWER" }
```

**Response 201:**
```json
{
  "accessToken": "eyJhbGci...",
  "user": { "id": "uuid", "email": "admin@example.com", "role": "OWNER" }
}
```

---

### `POST /api/v1/auth/login`
Authenticate and obtain tokens.

Same request/response shape as register. Sets an `HttpOnly` `refresh_token` cookie (30-day TTL).

---

### `POST /api/v1/auth/logout`
Revoke the current refresh token session.

---

### `GET /api/v1/auth/me`
Returns the current authenticated user.

---

## Server Endpoints

### `GET /api/v1/servers`
List all registered VPS nodes with their latest agent and metrics.

### `POST /api/v1/servers`
Register a new VPS node.

**Body:**
```json
{
  "name": "production-01",
  "provider": "Hetzner",
  "ipAddress": "95.217.34.101",
  "os": "Ubuntu 24.04",
  "architecture": "x86_64",
  "environment": "production"
}
```

**Response 201:** Returns the server record + `bootstrapToken` + `installCommand`.

### `GET /api/v1/servers/:id`
Get full server detail with agent status, last 20 metrics, last 10 tasks, and blueprints.

### `PATCH /api/v1/servers/:id`
Update mutable server fields (name, provider, ipAddress, os, architecture, environment, status).

### `DELETE /api/v1/servers/:id`
Remove a server and cascade-delete all associated data.

### `GET /api/v1/servers/:id/metrics?limit=60`
Return time-series health metrics (CPU, memory, disk, load, swap, uptime) in ascending time order. Default: last 60 data points.

### `GET /api/v1/servers/:id/logs?limit=50`
Return recent heartbeat payloads in descending time order.

---

## Task Endpoints

### `GET /api/v1/tasks`
List all tasks across all servers (newest first).

### `POST /api/v1/tasks`
Dispatch a new task to a server.

**Body:**
```json
{
  "serverId": "uuid",
  "type": "update_packages",
  "payload": {}
}
```

Valid task types: `install_docker`, `update_packages`, `restart_service`, `collect_logs`, `update_agent`, `restart_server`, `reboot`, `shutdown`, `restore_blueprint`.

**Response 202:** Task object with `status: "QUEUED"`.

### `GET /api/v1/tasks/:id`
Get task detail including all log entries.

### `POST /api/v1/tasks/:id/logs`
Append a log line to a task (used by agents).

### `POST /api/v1/tasks/:id/complete`
Mark a task as COMPLETED, FAILED, or CANCELLED (used by agents).

---

## Blueprint Endpoints

### `GET /api/v1/blueprints`
List all blueprints with their latest version.

### `POST /api/v1/blueprints`
Create and save a new blueprint (sanitized + validated by the blueprint engine).

**Body:**
```json
{
  "serverId": "uuid",
  "name": "web-api-stack",
  "manifest": { "os": "ubuntu-24.04", "packages": ["docker.io", "nginx"], ... }
}
```

### `POST /api/v1/blueprints/restore`
Queue a blueprint restoration task on a target server.

---

## Agent Endpoints (Agent Auth)

These endpoints use the agent credential token (not user JWT).

### `POST /api/v1/agent/register`
Exchange bootstrap token for an agent credential token.

### `POST /api/v1/agent/heartbeat`
Submit telemetry payload. Returns `{ "ok": true, "intervalSeconds": 10 }`.

### `GET /api/v1/agent/tasks/pending`
Poll for queued/running tasks assigned to this agent's server.

---

## Diagnostics & Backup

### `POST /api/v1/diagnostics/ai`
Sanitize raw log text (redacts secrets) and return diagnostic rules.

**Body:** `{ "rawLogs": "..." }`

### `GET /api/v1/backups/export`
Export a JSON archive of all servers and blueprints. Returns file download.

### `POST /api/v1/backups/import`
Import a backup archive. Upserts servers and creates blueprints.

---

## Error Format

All errors return:
```json
{ "error": "error_code", "details": [...] }
```

Common codes: `unauthorized`, `invalid_token`, `validation_error`, `account_exists`, `invalid_credentials`, `server_not_found`, `blueprint_version_not_found`.
