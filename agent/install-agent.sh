#!/usr/bin/env bash
set -Eeuo pipefail
CONTROL_PLANE="${POCKETCLOUD_CONTROL_PLANE:-}"; TOKEN=""
while [[ $# -gt 0 ]]; do case "$1" in --token) TOKEN="$2"; shift 2;; --control-plane) CONTROL_PLANE="$2"; shift 2;; *) echo "unknown argument: $1" >&2; exit 2;; esac; done
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }; [[ -n "$CONTROL_PLANE" && -n "$TOKEN" ]] || { echo "control plane and token required" >&2; exit 1; }
command -v curl >/dev/null || { apt-get update -y && apt-get install -y curl; }
install -d -m 0750 /opt/pocketcloud-agent /etc/pocketcloud
id pocketcloud-agent >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin pocketcloud-agent
curl --fail --proto '=https' --tlsv1.2 "$CONTROL_PLANE/api/v1/agent/releases/linux-$(uname -m)" -o /opt/pocketcloud-agent/pocketcloud-agent
chmod 0750 /opt/pocketcloud-agent/pocketcloud-agent
cat >/etc/pocketcloud/config.env <<EOF
CONTROL_PLANE=$CONTROL_PLANE
BOOTSTRAP_TOKEN=$TOKEN
EOF
chown -R pocketcloud-agent:pocketcloud-agent /opt/pocketcloud-agent /etc/pocketcloud
cat >/etc/systemd/system/pocketcloud-agent.service <<EOF
[Unit]
Description=PocketCloud Linux Agent
After=network-online.target
Wants=network-online.target
[Service]
User=pocketcloud-agent
EnvironmentFile=/etc/pocketcloud/config.env
ExecStart=/opt/pocketcloud-agent/pocketcloud-agent --control-plane ${CONTROL_PLANE} --token ${TOKEN}
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pocketcloud-agent
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload; systemctl enable --now pocketcloud-agent; systemctl is-active --quiet pocketcloud-agent
