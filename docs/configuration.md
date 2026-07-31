# PocketCloud Configuration

PocketCloud separates installation configuration from runtime configuration. The installer creates `/opt/pocketcloud/.env` with generated secrets and database credentials. Runtime settings are stored in the database and are intended to be managed from **Settings > Configuration**.

Secret settings are encrypted at rest with the installation encryption key. The API never returns plaintext secret values. Replacing a secret requires submitting a new value, and every update creates an `AuditLog` record.

Supported settings include the control-plane name, domain, agent heartbeat interval, CPU/memory/disk thresholds, backup retention, notification enablement, AI provider, and AI provider key.

Changing installation secrets such as `DATABASE_URL`, `JWT_SECRET`, or `ENCRYPTION_KEY` is intentionally not supported through the runtime settings screen because those changes require coordinated service rotation and restart. Use a planned maintenance procedure for those values.
