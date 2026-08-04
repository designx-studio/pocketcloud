# PocketCloud v2 — Feature Architecture Specification

**Audience:** the engineer implementing this. Assumes familiarity with the existing stack (PostgreSQL + Prisma, Fastify API, Redis-backed worker/scheduler, Go agent, Caddy reverse proxy, vanilla JS dashboard).

**Scope:** nine additions to the existing control plane, ordered by build priority. Each section is self-contained: schema diff, API surface, agent-side code where relevant, and rollout notes. Nothing here requires a rewrite of the existing Task Engine, Blueprint system, or agent registration flow — everything hooks into what's already there.

**Design constraint that applies to all nine:** the target node is a free-tier VPS, often 1 vCPU / 1GB RAM. Every feature below is control-plane-heavy and agent-light on purpose. If a feature needs non-trivial compute, it runs on the control plane, not the node.

---

## 0. Priority Order

| # | Feature | Why this order |
|---|---|---|
| 1 | Live Infrastructure Map | Zero new backend logic, mostly wiring — ship first for visible momentum |
| 2 | Encrypted Backup & Restore | Closes the biggest gap in the current pitch (blueprints ≠ data) |
| 3 | Free-Tier Lifecycle Tracking | The differentiating feature; depends on nothing else |
| 4 | Infrastructure Migration Planner | Completes the risk→recovery loop immediately after #3 |
| 5 | Prebuilt Service Catalog | Fast follow, mostly data + one new task type |
| 6 | Notification Layer | Small, but everything after this benefits from it |
| 7 | Drift Detection | Needs #6 to be useful |
| 8 | Ingress/Tunnel for NAT'd Nodes | Bigger lift — new protocol work in the agent |
| 9 | Single-User Lite Deploy Mode | Infra change, do it once the feature set is stable |

Roadmap-only (not this cycle): **AI-assisted diagnostics via OpenCode**.

---

## 1. Live Infrastructure Map

**Goal:** the moment a node finishes registration, it appears on the map — no refresh, no polling delay.

### 1.1 Schema addition

Add placement metadata to the existing `Server` model. No new table needed.

```prisma
model Server {
  // ...existing fields...
  region        String?  // provider-reported region
  latitude      Float?   // resolved from provider+region lookup at registration time
  longitude     Float?
}
```

### 1.2 Provider/region → coordinates lookup

A static table, not a DB model.

```ts
// src/lib/regionCoordinates.ts
export const REGION_COORDINATES: Record<string, [number, number]> = {
  "oracle:eu-frankfurt-1":     [50.1109, 8.6821],
  "oracle:us-ashburn-1":       [39.0438, -77.4874],
  "hetzner:fsn1":              [50.5941, 11.0126],
  "hetzner:nbg1":              [49.4478, 11.0683],
  "digitalocean:nyc1":         [40.7128, -74.0060],
  "digitalocean:fra1":         [50.1109, 8.6821],
  "vultr:sgp":                 [1.3521, 103.8198],
  "homelab:unknown":           [0, 0],
};

export function resolveCoordinates(provider: string, region?: string): [number, number] | null {
  const key = `${provider}:${region ?? "unknown"}`;
  return REGION_COORDINATES[key] ?? null;
}
```

### 1.3 Push the update — SSE, not another poll loop

```ts
// src/lib/mapEvents.ts
import { EventEmitter } from "node:events";
export const mapEvents = new EventEmitter();
```

```ts
// src/routes/map.ts
app.get("/api/v1/map/stream", (req, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const onAdded = (payload: unknown) => {
    reply.raw.write(`event: server:added\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  mapEvents.on("server:added", onAdded);
  req.raw.on("close", () => mapEvents.off("server:added", onAdded));
});
```

### 1.4 Dashboard

```js
const es = new EventSource("/api/v1/map/stream");
es.addEventListener("server:added", (evt) => {
  const server = JSON.parse(evt.data);
  addMarkerToMap(server);
});
```

---

## 2. Encrypted One-Click Backup & Restore

**Goal:** a button that produces a downloadable, encrypted backup of an app's data.

### 2.1 Schema — extend the existing `Backup` model

```prisma
model Backup {
  id             String   @id @default(cuid())
  serverId       String
  server         Server   @relation(fields: [serverId], references: [id])
  blueprintId    String?
  label          String
  sizeBytes      BigInt
  checksumSha256 String
  storageKey     String
  storageBackend String   // "s3" | "hetzner-storagebox" | "local"
  encrypted      Boolean  @default(true)
  status         String   // QUEUED | RUNNING | COMPLETE | FAILED
  createdAt      DateTime @default(now())
  completedAt    DateTime?
}
```

### 2.2 Encryption model — passphrase never touches the database

- Operator supplies passphrase at backup time
- Passphrase sent to agent via ephemeral Redis secret (60s TTL)
- Agent encrypts locally with `age` before upload
- Restore requires same passphrase re-entry

### 2.3 New task types: `backup_data` and `restore_data`

### 2.4 API endpoints: `POST /api/v1/backups`, `GET /api/v1/backups/:id/download`

### 2.5 Restore pairs with existing blueprint-restore workflow

---

## 3. Free-Tier Lifecycle Tracking

**Goal:** surface reclamation/expiry risk before it happens.

### 3.1 Schema additions to `Server`

```prisma
  tierType         String?   // "always_free" | "trial" | "credit" | "paid"
  tierExpiresAt    DateTime?
  lifecycleRisk    String    @default("UNKNOWN") // "SAFE" | "WATCH" | "AT_RISK" | "UNKNOWN"
  lastActivityAt   DateTime?
```

### 3.2 Static provider policy table

### 3.3 Risk computation in existing Scheduler (hourly)

### 3.4 `lastActivityAt` — reuse existing heartbeat, threshold CPU > 5%

### 3.5 Dashboard: colored badge + "Migrate this server" CTA

---

## 4. Infrastructure Migration Planner

**Goal:** answer "if this server disappears, what actually breaks?"

### 4.1 Dependency inference from blueprint env_vars

### 4.2 Migration time estimate from historical task durations

### 4.3 Replacement suggestions — static equivalence table

### 4.4 API: `GET /api/v1/servers/:id/migration-plan` (read-only)

### 4.6 Schema additions: `role` and `importance` fields on `Server`

---

## 5. Prebuilt Service Catalog

**Goal:** one click from zero to a running Pi-hole/Uptime Kuma/Gitea/Jellyfin.

### 5.1 Catalog entries as YAML files in-repo

### 5.2 Seed script loads into `Blueprint` rows with `isSystemCatalog: true`

### 5.3 API: `GET /api/v1/catalog`, `POST /api/v1/catalog/:slug/deploy`

### 5.4 Reuses existing `restore_blueprint` task type

---

## 6. Notification Layer

**Goal:** server offline, task failed, backup failed, lifecycle at-risk — all currently silent.

### 6.1 Schema: `NotificationChannel` model

### 6.2 Central dispatcher: `notify(event, payload)`

### 6.3 Wire into existing event sources (offline marking, task failures, lifecycle risk)

---

## 7. Drift Detection

**Goal:** catch the gap between blueprint and reality.

### 7.1 New task type: `check_drift` (read-only, safe to run unattended)

### 7.2 Scheduled dispatch — daily, per server with attached blueprint

### 7.3 On result — compare and notify, don't auto-fix

---

## 8. Ingress/Tunnel for NAT'd Home Lab Nodes

**Goal:** home lab behind NAT gets a real HTTPS subdomain.

### 8.1 Multiplex tunnel over existing agent connection using yamux

### 8.2 Schema: `TunnelRoute` model

### 8.3 Agent side: yamux client + local proxy

### 8.4 Control plane: tunnel router service + Caddy wildcard

### 8.5 Security: explicit port whitelist, rate limiting, ownership validation

---

## 9. Single-User Lite Deployment Mode

**Goal:** one binary, one SQLite file — no Postgres/Redis required.

### 9.1 Prisma multi-datasource (two schema files)

### 9.2 In-process queue instead of Redis

### 9.3 Single-container deployment artifact

### 9.4 Upgrade path to full mode

---

## Summary — file/module footprint

| Feature | New Prisma models | New tables | New task types | New API routes | Agent changes |
|---|---|---|---|---|---|
| 1. Live Map | 0 (fields only) | 0 | 0 | 1 (SSE stream) | none |
| 2. Backup/Restore | 0 (fields only) | 0 | 2 | 2 | 1 new file |
| 3. Lifecycle Tracking | 0 (fields only) | 0 | 0 | 0 (scheduler only) | none |
| 4. Migration Planner | 0 (2 fields only) | 0 | 0 | 1 (read-only) | none |
| 5. Service Catalog | 0 (fields only) | 0 | 0 (reuses existing) | 2 | none |
| 6. Notifications | 1 | 1 | 0 | small CRUD | none |
| 7. Drift Detection | 0 (fields only) | 0 | 1 | 0 | 1 new file |
| 8. Tunnel/Ingress | 1 | 1 | 0 | new router service | 1 new file |
| 9. Lite Deploy Mode | 0 (dup schema) | 0 | 0 | 0 | none |