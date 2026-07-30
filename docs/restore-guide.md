# Restore Guide

This guide covers restoring your infrastructure using PocketCloud blueprints and backup archives.

## Blueprint Restoration (Environment Migration)

Use this to recreate a server's environment on a new VPS.

### Step 1: Verify Target Server

The target server must be:
- Registered in PocketCloud (added via **+ Add Server**)
- Status: **ONLINE** (agent paired and heartbeating)
- Running Ubuntu 22.04+ (same OS family recommended)

### Step 2: Select Blueprint

1. In the dashboard, navigate to **Blueprints & Migration**
2. Find the blueprint you want to restore
3. Click **1-Click Migration Wizard**

### Step 3: Select Target

- Choose the target VPS from the dropdown (only ONLINE servers shown)
- The system checks OS compatibility and shows any warnings
- Warnings do not block restoration — they are advisory

### Step 4: Execute

Click **Execute Restoration**. This creates a `restore_blueprint` task on the target server.

The agent will:
1. Install required packages via `apt-get`
2. Apply Docker Compose definitions if present
3. Configure systemd services
4. Stream progress logs back (visible in the Tasks tab)

### Step 5: Monitor

Navigate to **Tasks & Actions** to watch real-time execution logs.

Expected completion time: 2–15 minutes depending on packages and Docker image downloads.

---

## Control Plane Backup Restore

Use this to restore a PocketCloud control plane from a backup archive.

### Backup File Format

PocketCloud backup files are JSON with this structure:

```json
{
  "version": "1.1.0",
  "exportedAt": "2025-01-15T10:00:00Z",
  "users": [...],
  "servers": [...],
  "blueprints": [...]
}
```

### Restoring from Backup

#### Option A: Fresh Control Plane

1. Install a fresh control plane: `curl -fsSL https://install.pocketcloud.dev | bash`
2. Register an account via the dashboard
3. Navigate to **Settings & Disaster Recovery**
4. Upload your backup JSON file
5. Click **Import Backup**

The importer will:
- Upsert all servers (matched by ID if present)
- Create blueprints with their version history
- Return a count of imported items

> **Note:** Users and sessions are not imported (security policy). You must re-register operator accounts.

#### Option B: Existing Control Plane via API

```bash
curl -X POST https://<domain>/api/v1/backups/import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @pocketcloud-backup-2025-01-15.json
```

### Re-Pair Agents After Control Plane Restore

Imported servers will have status `OFFLINE` — their agents are pointing at the old control plane. To re-pair:

1. For each imported server, click the server in the dashboard
2. Generate a new bootstrap token via **Add Server** with the same details
3. SSH into the VPS and update `/etc/pocketcloud/config.env`:
   ```bash
   CONTROL_PLANE=https://<new-domain>
   BOOTSTRAP_TOKEN=<new-token>
   ```
4. Restart the agent: `systemctl restart pocketcloud-agent`

---

## Disaster Recovery Runbook

### Scenario: Control Plane VPS Destroyed

1. Provision a new VPS (Ubuntu 22.04+, 2 GB RAM minimum)
2. Install PocketCloud: `curl -fsSL https://install.pocketcloud.dev | bash`
3. Import most recent backup via the dashboard
4. Update DNS A record for your domain to the new IP
5. Wait for Caddy to obtain a new TLS certificate (1–2 minutes)
6. Re-pair all agents (see above)
7. Verify all servers show ONLINE within 30 seconds

### Scenario: PostgreSQL Corruption

1. Stop all services: `docker compose stop api worker scheduler task-engine`
2. Restore from last PostgreSQL dump:
   ```bash
   cat /opt/pocketcloud/backups/postgres-dump.sql | \
     docker compose exec -T database psql -U pocketcloud pocketcloud
   ```
3. Run migrations: `docker compose exec api npx prisma migrate deploy`
4. Restart services: `docker compose start`

### Scenario: Single Agent Compromise

1. Delete the Agent record in PocketCloud dashboard (revokes credential)
2. SSH into VPS and rebuild from clean snapshot
3. Re-register via **+ Add Server** with the same details
4. Install fresh agent with new bootstrap token
