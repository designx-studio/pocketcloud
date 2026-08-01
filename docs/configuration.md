# PocketCloud Configuration

PocketCloud separates installation configuration from runtime configuration.

## Canonical environment file

The installer creates a single canonical file:

```text
/opt/pocketcloud/.env
```

Docker Compose loads it via `env_file: ../.env` (relative to `deploy/docker-compose.yml`). Do not maintain a second secrets file under `deploy/.env` except as a symlink to `../.env`.

Runtime settings are stored in the database and are intended to be managed from **Settings > Configuration**.

Secret settings are encrypted at rest with the installation encryption key. The API never returns plaintext secret values. Replacing a secret requires submitting a new value, and every update creates an `AuditLog` record.

Supported settings include the control-plane name, domain, agent heartbeat interval, CPU/memory/disk thresholds, backup retention, notification enablement, AI provider, and AI provider key.

Changing installation secrets such as `DATABASE_URL`, `JWT_SECRET`, or `ENCRYPTION_KEY` is intentionally not supported through the runtime settings screen because those changes require coordinated service rotation and restart. Use a planned maintenance procedure for those values.

## Production vs development

### Production (installer-generated)

```env
NODE_ENV=production
APP_URL=https://cloud.example.com
API_URL=https://cloud.example.com/api
WS_URL=wss://cloud.example.com/ws
CORS_ORIGIN=https://cloud.example.com
```

Rules enforced by the installer and the API:

- `CORS_ORIGIN` must not be `*`
- `APP_URL` and `CORS_ORIGIN` must be `https://` origins
- `localhost` is rejected
- `APP_URL`, `API_URL`, `WS_URL`, and `CORS_ORIGIN` are derived from the domain entered once at install time

### Development

```env
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:8080
WS_URL=ws://localhost:8080
CORS_ORIGIN=*
```

Wildcard CORS is allowed only when `NODE_ENV=development` (or `test`). Outside the wildcard case, `CORS_ORIGIN` is a comma-separated allowlist of exact browser origins.

### Optional public surfaces

| Variable | Default (dev) | Default (production) | Effect |
|---|---|---|---|
| `ENABLE_API_DOCS` | `true` | `false` | Serves Swagger UI and the OpenAPI document at `/docs` |
| `ENABLE_DEMO_MODE` | `true` | `false` | Serves `POST /api/v1/auth/demo`, which issues a read-only session to anyone and seeds sample data |

## Validation failures

If the API exits immediately on boot, check container logs. Configuration errors print:

```text
PocketCloud failed to start.

Configuration validation failed.

Review:

/opt/pocketcloud/.env
```

Fix the values in `/opt/pocketcloud/.env`, then recreate the stack:

```bash
docker compose -f /opt/pocketcloud/deploy/docker-compose.yml \
  --env-file /opt/pocketcloud/.env up -d
```
