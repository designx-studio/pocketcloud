# PocketCloud Agent Guide

The PocketCloud Agent is a statically compiled Go binary that runs on each managed Linux VPS.

## How It Works

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

All communication is **outbound from the agent** — no inbound firewall rules are needed.

## Installation

On your control plane dashboard, click **+ Add Server**, fill in the server details, then run the generated command on your VPS via SSH:

```bash
curl -fsSL https://<your-domain>/install-agent.sh \
  | bash -s -- \
    --control-plane https://<your-domain> \
    --token <bootstrap-token>
```

The installer:
1. Creates system user `pocketcloud-agent` (no shell, no home directory)
2. Downloads the agent binary matching your CPU architecture
3. Writes `/etc/pocketcloud/config.env` with the bootstrap token
4. Installs and starts the `pocketcloud-agent` systemd service
5. Enables auto-restart with 5-second back-off

## Supported Platforms

| Platform | Binary |
|---|---|
| Linux x86_64 (amd64) | `pocketcloud-agent-linux-x86_64` |
| Linux ARM64 (aarch64) | `pocketcloud-agent-linux-aarch64` |
| Linux ARM v7 | `pocketcloud-agent-linux-armv7l` |

## Allow-Listed Task Types

Agents only execute tasks explicitly dispatched from the control plane:

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

## Operational Commands

```bash
# Check agent status
systemctl status pocketcloud-agent

# View live logs
journalctl -fu pocketcloud-agent

# Restart agent
systemctl restart pocketcloud-agent

# Update agent manually
curl -fsSL https://<control-plane>/api/v1/agent/releases/linux-x86_64 \
  -o /opt/pocketcloud-agent/pocketcloud-agent
systemctl restart pocketcloud-agent
```

## Security Model

- Agent runs as unprivileged system user `pocketcloud-agent`
- `NoNewPrivileges=true` in systemd unit
- `ProtectSystem=strict` — root filesystem read-only
- `ProtectHome=true` — home directories inaccessible
- Bootstrap tokens are single-use and expire in 1 hour
- Agent credential tokens are SHA-256 hashed in the database
- All communication uses HTTPS (TLS 1.2+)
