#!/usr/bin/env bash
set -Eeuo pipefail
CONTROL_PLANE="${POCKETCLOUD_CONTROL_PLANE:-}"
TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --control-plane) CONTROL_PLANE="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ -n "$CONTROL_PLANE" && -n "$TOKEN" ]] || { echo "control plane and token required" >&2; exit 1; }
command -v curl >/dev/null || { apt-get update -y && apt-get install -y curl; }

# Stop any existing agent service before writing the binary to avoid
# curl error 23 (write failure) when the old binary is still open/running.
if systemctl is-active --quiet pocketcloud-agent 2>/dev/null; then
  systemctl stop pocketcloud-agent
fi

install -d -m 0750 /opt/pocketcloud-agent /etc/pocketcloud /var/lib/pocketcloud-agent
id pocketcloud-agent >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin pocketcloud-agent

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) PLATFORM=linux-x86_64 ;;
  aarch64|arm64) PLATFORM=linux-aarch64 ;;
  armv7l|armv7) PLATFORM=linux-armv7l ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
BINARY=/opt/pocketcloud-agent/pocketcloud-agent
if ! curl --fail --silent --show-error --proto '=http,https' --tlsv1.2 "$CONTROL_PLANE/api/v1/agent/releases/$PLATFORM" -o "$BINARY"; then
  RELEASE_URL="https://github.com/designx-studio/pocketcloud/releases/latest/download/pocketcloud-agent-$PLATFORM"
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 "$RELEASE_URL" -o "$BINARY"
fi
chmod 0750 "$BINARY"
cat >/etc/pocketcloud/config.env <<EOF
CONTROL_PLANE=$CONTROL_PLANE
BOOTSTRAP_TOKEN=$TOKEN
EOF
chmod 0640 /etc/pocketcloud/config.env
chown -R pocketcloud-agent:pocketcloud-agent /opt/pocketcloud-agent /etc/pocketcloud /var/lib/pocketcloud-agent
cat >/etc/systemd/system/pocketcloud-agent.service <<EOF
[Unit]
Description=PocketCloud Linux Agent
After=network-online.target
Wants=network-online.target
[Service]
User=pocketcloud-agent
EnvironmentFile=/etc/pocketcloud/config.env
ExecStart=$BINARY --control-plane ${CONTROL_PLANE} --token ${TOKEN}
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pocketcloud-agent
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now pocketcloud-agent
systemctl is-active --quiet pocketcloud-agent