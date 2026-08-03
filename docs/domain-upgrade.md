# Domain Upgrade

After an IP quick start install, point a DNS record at the VPS and run:

```bash
sudo pocketcloud upgrade-domain cloud.example.com
```

The command updates `APP_URL`, `API_URL`, `WS_URL`, `CORS_ORIGIN`, and `POCKETCLOUD_DOMAIN`, rewrites the Caddy site configuration, removes the IP-mode banner, and recreates Caddy without touching PostgreSQL, Redis, or application data.

Verify:

```bash
curl -fsSL https://cloud.example.com/health
cd /opt/pocketcloud
docker compose -f deploy/docker-compose.yml ps
```
