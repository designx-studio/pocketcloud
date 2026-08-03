# PocketCloud Quick Start

## IP mode

For a fresh Ubuntu VPS with no DNS configured:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash -s -- --ip
```

PocketCloud runs at `http://SERVER_IP`. No DNS or SSL setup is required.

## Domain mode

For automatic HTTPS:

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash -s -- --domain cloud.example.com
```

Point DNS at the VPS first. Caddy provisions the certificate automatically.

## Explicit URL mode

```bash
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash -s -- --app-url http://159.89.171.72
curl -fsSL https://raw.githubusercontent.com/designx-studio/pocketcloud/main/deploy/install.sh | sudo bash -s -- --app-url https://cloud.example.com
```

The installer rejects malformed URLs, `http://` domains, and `https://` IP addresses.

## Upgrade an IP install to a domain

```bash
sudo pocketcloud upgrade-domain cloud.example.com
```

This preserves the database and secrets, updates the public URLs, enables Caddy HTTPS, removes the quick-start banner, and recreates only Caddy.

## Quick Start positioning

- No DNS required
- No SSL setup
- Deploy in under five minutes
- Useful for learning, homelabs, and temporary VPS testing
- Upgrade to HTTPS later without reinstalling
