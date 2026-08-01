# Troubleshooting Guide

## Dashboard Issues

### "No servers connected" after login

The dashboard shows real data only — there are no demo/mock servers.

**Steps:**
1. Make sure the API server is running (`npm run dev` in `apps/api/`)
2. Verify CORS is configured for your environment:
   - Development: `CORS_ORIGIN=*` in the repo-root `.env`
   - Production: `CORS_ORIGIN=https://your-domain` in `/opt/pocketcloud/.env` (never `*`)
3. Check browser console for network errors
4. Try registering an account first (the login modal has a Register toggle)

---

### API container exits immediately / unhealthy after install

**Symptom:** `docker compose ps` shows `api` as `Exit` or `unhealthy`; dependents never start.

**Common cause:** invalid production configuration — especially `CORS_ORIGIN=*`.

**Fix:**
1. Inspect logs: `docker compose -f /opt/pocketcloud/deploy/docker-compose.yml logs api`
2. Look for:
   ```text
   PocketCloud failed to start.
   Configuration validation failed.
   CORS_ORIGIN cannot be '*' in production.
   ```
3. Edit the **canonical** env file (not a second copy):
   ```bash
   nano /opt/pocketcloud/.env
   ```
4. Set explicit HTTPS origins derived from your domain:
   ```env
   NODE_ENV=production
   APP_URL=https://cloud.example.com
   API_URL=https://cloud.example.com/api
   WS_URL=wss://cloud.example.com/ws
   CORS_ORIGIN=https://cloud.example.com
   ```
5. Recreate services:
   ```bash
   docker compose -f /opt/pocketcloud/deploy/docker-compose.yml \
     --env-file /opt/pocketcloud/.env up -d
   ```

The installer now generates these values automatically from `POCKETCLOUD_DOMAIN` and validates them before Docker starts.

---

### Login fails with "Invalid email or password"

The database is empty on a fresh install. Register a new account first using the auth modal's **"Don't have an account? Register"** link.

---

### "Session expired" toast appears repeatedly

The JWT access token has a 15-minute TTL. This means:
- The user was inactive for >15 minutes
- The API was restarted (JWT_SECRET rotated)

**Fix:** Log out and log in again. If this happens frequently, check that your JWT_SECRET is stable across restarts (set in `.env`, not generated at runtime).

---

## API Issues

### API returns `500 internal_error: connect ECONNREFUSED`

The API cannot connect to PostgreSQL.

**Local dev:**
```bash
# Start Postgres with Docker
docker run -d --name pg \
  -e POSTGRES_USER=pocketcloud \
  -e POSTGRES_PASSWORD=pocketcloud \
  -e POSTGRES_DB=pocketcloud \
  -p 5432:5432 postgres:16-alpine
```

**Production:** Check `docker compose ps` — the `database` container should be `healthy`.

---

### `PrismaClientInitializationError`

Migrations have not been run.

```bash
cd apps/api
npx prisma migrate deploy   # production
npx prisma migrate dev      # development (creates migration files)
```

---

### API returns `401 unauthorized` on all requests

- The JWT token is missing or expired
- Check that the frontend is sending `Authorization: Bearer <token>` header
- Ensure `JWT_SECRET` in `.env` matches what the API started with

---

## Agent Issues

### Agent shows as OFFLINE immediately after pairing

The scheduler marks servers OFFLINE if `lastSeenAt` > 30 seconds ago. This means:

1. The agent binary is not running — check: `systemctl status pocketcloud-agent`
2. The agent cannot reach the control plane — check firewall/DNS
3. The agent credential was rejected — the bootstrap token may have been used twice

**Fix:**
```bash
# On the VPS:
systemctl status pocketcloud-agent
journalctl -fu pocketcloud-agent
curl -v https://<control-plane>/health
```

---

### `registration returned HTTP 401` in agent logs

The bootstrap token:
- Has already been used (single-use)
- Has expired (1-hour TTL)

**Fix:** Generate a new server registration in the dashboard (click **+ Add Server** again with the same details — this creates a new bootstrap token).

---

### Tasks stay in QUEUED state forever

The task engine or worker process is not running.

**Production:** Check `docker compose ps` — `worker`, `scheduler`, and `task-engine` containers must be running.

**Development:** Run worker separately:
```bash
cd apps/api
npx tsx src/worker.ts
```

Also verify the agent is polling:
```bash
# On the VPS:
journalctl -fu pocketcloud-agent | grep -i task
```

---

### Task shows FAILED: "target server went OFFLINE"

The agent disconnected before the task could execute. Possible causes:

- Network interruption between agent and control plane
- The VPS was rebooted
- Agent process crashed

**Fix:** Restart the agent (`systemctl restart pocketcloud-agent`), wait for it to reconnect (status shows ONLINE), then re-dispatch the task.

---

## Blueprint Issues

### Blueprint restore shows "target_server_not_online"

The API validates that the target server is ONLINE before queuing a restore task. Ensure:
- The agent is running and heartbeating
- The server status shows ONLINE in the dashboard

---

### Blueprint captures `[REDACTED]` secrets

This is by design. The `sanitizeEnvironment()` function redacts all secrets at capture time. You must manually re-enter secrets after restoration.

---

## Build Issues

### `npm run build` fails with TypeScript errors

```bash
# Clean and rebuild
rm -rf apps/api/dist
npm run build
```

If the error is in `@pocketcloud/blueprint` imports, verify:
```json
// apps/api/tsconfig.json should have:
"paths": { "@pocketcloud/blueprint": ["../../packages/blueprint/index.ts"] }
```

---

### `Cannot find module '@prisma/client'`

Prisma client has not been generated.

```bash
cd apps/api
npx prisma generate
```

---

## Logs & Diagnostics

### View all component logs in production

Always use the canonical env file at `/opt/pocketcloud/.env`:

```bash
cd /opt/pocketcloud
COMPOSE="docker compose -f deploy/docker-compose.yml --env-file /opt/pocketcloud/.env"

# All services
$COMPOSE logs -f

# Specific service
$COMPOSE logs -f api
$COMPOSE logs -f worker
$COMPOSE logs -f scheduler

# Database
$COMPOSE exec database psql -U pocketcloud pocketcloud -c "SELECT * FROM \"Task\" ORDER BY \"createdAt\" DESC LIMIT 10;"
```

### Run AI Log Diagnostics

1. Navigate to **Logs & AI Diagnostics** in the dashboard
2. The console auto-populates with recent heartbeat telemetry
3. Click **Run AI Diagnostics** to sanitize and analyze logs
4. Results appear below showing anomaly detection rules

---

## Getting Help

- GitHub Issues: `https://github.com/designx-studio/pocketcloud/issues`
- API Docs: `https://<your-domain>/docs`
- Architecture: [`docs/architecture.md`](./architecture.md)
