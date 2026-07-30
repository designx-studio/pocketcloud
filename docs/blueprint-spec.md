# PocketCloud Blueprint Specification

Blueprints are declarative JSON/YAML specifications that capture a server's environment configuration so it can be reproduced on a different VPS in one click.

## Blueprint Structure

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

## Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Unique blueprint name |
| `os` | string | ✅ | Target OS (e.g. `ubuntu-24.04`) |
| `provider` | string | | Cloud provider |
| `environment` | string | | `production`, `staging`, `dev` |
| `packages` | string[] | | apt packages to install |
| `services` | object[] | | systemd services |
| `docker` | object | | Docker Compose spec |
| `env_vars` | object | | Non-secret environment |
| `cron_jobs` | object[] | | crontab entries |

## Security: Secret Redaction

When a blueprint is saved via `POST /api/v1/blueprints`, the `sanitizeEnvironment()` function in `@pocketcloud/blueprint` automatically redacts sensitive values matching these patterns:

- Keys containing: `password`, `secret`, `token`, `credential`, `api_key`, `private_key`, `auth`, `passphrase`
- All values are replaced with `"[REDACTED]"` — the keys are preserved for documentation purposes

**This redaction is irreversible.** Secrets must be re-entered manually during restoration.

## Compatibility Checks

When restoring a blueprint to a target server, `validateCompatibility()` checks:

- OS family match (Ubuntu to Ubuntu, Debian to Debian)
- Architecture match (x86_64 vs aarch64)
- Major version match (Ubuntu 22 blueprint → Ubuntu 24 target → warning, not block)

Compatibility warnings are recorded in the task payload and shown in the dashboard.

## Versioning

Every call to `POST /api/v1/blueprints` with an existing name creates a new `BlueprintVersion` record. Version numbers are integers starting at 1 and increment automatically. Each version stores:

- Full manifest (JSON)
- SHA-256 checksum of the manifest
- Creation timestamp

Previous versions are preserved and can be restored independently.

## Restoration Process

1. Operator selects blueprint + target server in dashboard
2. `POST /api/v1/blueprints/restore` creates a `restore_blueprint` task
3. Agent executes the task payload (packages, services, docker)
4. Logs stream back in real-time via the task log API
5. Operator verifies via the Tasks tab

## Blueprint Engine Package

The `@pocketcloud/blueprint` package (`packages/blueprint/index.ts`) provides:

```typescript
// Sanitize and redact secrets from a raw manifest
sanitizeEnvironment(manifest: Record<string, unknown>): Record<string, unknown>

// Parse and validate a manifest against the Blueprint Zod schema
parseBlueprintManifest(manifest: unknown): BlueprintManifest

// Check OS/arch compatibility
validateCompatibility(manifest: BlueprintManifest, targetOs: string): CompatibilityResult
```
