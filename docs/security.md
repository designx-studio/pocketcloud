# PocketCloud Security Guide

## Threat Model

PocketCloud is a privileged infrastructure control plane. It has SSH-equivalent access to all managed servers. The threat model addresses:

1. **Unauthorized control plane access** — operator account compromise
2. **Agent spoofing** — fake agent sends malicious telemetry
3. **Credential leakage** — secrets exposed in blueprints or logs
4. **Network interception** — MITM between agent and control plane
5. **Privilege escalation** — compromised agent elevates to root

---

## Authentication

### Operator Accounts

- Passwords hashed with **Argon2id** (OWASP-recommended, memory-hard)
  - Memory: 64 MB, Iterations: 3, Parallelism: 4
- Access tokens: **JWT HS256**, 15-minute TTL
- Refresh tokens: 256-bit random bytes, **SHA-256 hashed** before storage, 30-day TTL
- Sessions are revocable via logout (sets `revokedAt` timestamp)

### Agent Authentication

1. **Bootstrap Token** (first contact):
   - Generated with `crypto.randomBytes(32)` → 256 bits of entropy
   - SHA-256 hashed before database storage
   - **Single-use** — marked `usedAt` immediately after first use
   - **1-hour TTL** — expires even if unused

2. **Agent Credential Token** (ongoing):
   - Issued after successful bootstrap
   - SHA-256 hashed before storage
   - Presented in `Authorization: Bearer` header on every request
   - No expiry — revoke by deleting the Agent record

---

## Secret Management

### Control Plane Secrets

Generated during installation via `openssl rand`:

| Secret | Length | Usage |
|---|---|---|
| `JWT_SECRET` | 512 bits | HMAC key for access tokens |
| `REFRESH_TOKEN_SECRET` | 512 bits | HMAC key for refresh tokens |
| `ENCRYPTION_KEY` | 256 bits | AES key for at-rest encryption |
| `POSTGRES_PASSWORD` | 256 bits | Database password |

**Never commit `.env` to version control.** The `.env.example` file contains placeholder values only. Production secrets live only at `/opt/pocketcloud/.env`.

### Blueprint Secret Redaction

Blueprints automatically redact values whose keys match:
`password`, `secret`, `token`, `credential`, `api_key`, `private_key`, `auth`, `passphrase`

Redaction happens at capture time (server-side) and is **irreversible**.

---

## Network Security

### TLS

- Caddy manages TLS automatically via **Let's Encrypt ACME**
- HTTPS enforced — HTTP requests redirect to HTTPS
- TLS 1.2+ minimum (Caddy default)
- HSTS header set via Caddy

### Agent Communication

- All agent→API communication uses HTTPS
- Agent verifies server TLS certificate (no `--insecure` flag)
- Outbound-only — agent never opens inbound ports
- No VPN or SSH tunneling required

### API Security Headers

`@fastify/helmet` sets:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy` (strict defaults)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Powered-By` header removed (Caddy config)

### Rate Limiting

- **300 requests/minute per IP** (API level, via `@fastify/rate-limit`)
- Returns `429 Too Many Requests` with `Retry-After` header

---

## Agent Hardening

The systemd unit for `pocketcloud-agent` enforces:

```ini
NoNewPrivileges=true        # Cannot gain elevated privileges
ProtectSystem=strict        # Root filesystem read-only
ProtectHome=true            # Cannot read /home or /root
ReadWritePaths=/var/lib/pocketcloud-agent  # Only writable path
User=pocketcloud-agent      # Unprivileged system user (no shell)
```

---

## Audit Logging

The `AuditLog` table records every significant action:
- User account creation/deletion
- Server registration/deletion
- Task dispatch and completion
- Blueprint creation and restoration
- Backup export/import

Audit logs are **immutable** — there is no API endpoint to delete them.

---

## Backup Security

- Backup exports are JSON files containing server metadata and blueprint manifests
- **Secrets are NOT included** — they are redacted at capture time
- Backup files should be encrypted at rest using your preferred tool (e.g., `gpg --symmetric`)
- Store backups off-site (S3, Backblaze, etc.)

---

## Incident Response

If a control plane is compromised:

1. Immediately rotate all secrets in `/opt/pocketcloud/.env`
2. Restart all services: `docker compose restart`
3. Revoke all agent credentials via the API (delete Agent records)
4. Re-pair agents with new bootstrap tokens
5. Audit the `AuditLog` table for unauthorized actions
6. Review `Session` table and revoke all active sessions

If an agent VPS is compromised:

1. Delete the Agent record via the API
2. The credential token is immediately invalid
3. Rebuild the VPS from a clean image
4. Re-pair with a new bootstrap token
