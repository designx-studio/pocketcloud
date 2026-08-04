// PocketCloud v2 API Routes
// All v2 feature endpoints under /v2/*

import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Feature 7: drift_snapshot is a raw SQL table, not in Prisma schema
const DRIFT_SQL = `
  CREATE TABLE IF NOT EXISTS drift_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    manifest_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS drift_snapshot_server_id ON drift_snapshot(server_id);
`;

export async function registerV2Routes(app: FastifyInstance) {
    // Ensure drift table exists at startup
    try {
        await prisma.$executeRawUnsafe(DRIFT_SQL);
    } catch (e) {
        console.warn("[v2] drift_snapshot table init skipped:", e);
    }

    // Feature 1: Live Infrastructure Map
    app.get("/v2/map/sse", async (req, reply) => {
        reply.raw.setHeader("Content-Type", "text/event-stream");
        reply.raw.setHeader("Cache-Control", "no-cache");
        reply.raw.setHeader("Connection", "keep-alive");

        const send = (data: Record<string, unknown>) => {
            reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Immediate snapshot
        const servers = await prisma.server.findMany({
            select: {
                id: true,
                name: true,
                provider: true,
                region: true,
                latitude: true,
                longitude: true,
                status: true,
                tierType: true,
                lifecycleRisk: true,
                lastActivityAt: true,
            },
        });
        send({ type: "snapshot", servers });

        // Keep-alive + poll for changes every 10s
        const interval = setInterval(async () => {
            const updated = await prisma.server.findMany({
                select: {
                    id: true,
                    status: true,
                    lifecycleRisk: true,
                    lastActivityAt: true,
                },
            });
            send({ type: "update", servers: updated });
        }, 10000);

        req.raw.on("close", () => {
            clearInterval(interval);
        });
    });

    // Feature 2: Encrypted Backup & Restore
    app.post("/v2/backups", async (req, reply) => {
        const body = req.body as {
            serverId: string;
            label: string;
            storageBackend?: string;
        };

        const backup = await prisma.dataBackup.create({
            data: {
                serverId: body.serverId,
                label: body.label,
                storageBackend: body.storageBackend ?? "local",
                status: "QUEUED",
            },
        });

        // Enqueue backup task
        await prisma.task.create({
            data: {
                serverId: body.serverId,
                type: "backup",
                payload: { backupId: backup.id, label: body.label },
                requestedBy: (req as any).user?.id ?? "system",
            },
        });

        return reply.code(201).send(backup);
    });

    app.get("/v2/backups", async () => {
        return prisma.dataBackup.findMany({
            orderBy: { createdAt: "desc" },
            take: 100,
        });
    });

    app.post("/v2/backups/:id/restore", async (req, reply) => {
        const { id } = req.params as { id: string };

        const backup = await prisma.dataBackup.findUnique({ where: { id } });
        if (!backup) return reply.code(404).send({ error: "Backup not found" });

        await prisma.task.create({
            data: {
                serverId: backup.serverId,
                type: "restore",
                payload: { backupId: id },
                requestedBy: (req as any).user?.id ?? "system",
            },
        });

        return { status: "queued", backupId: id };
    });

    // Feature 3: Free-Tier Lifecycle Tracking
    app.get("/v2/lifecycle/risk", async () => {
        const atRisk = await prisma.server.findMany({
            where: { lifecycleRisk: { not: "SAFE" } },
            select: {
                id: true,
                name: true,
                provider: true,
                tierType: true,
                tierExpiresAt: true,
                lifecycleRisk: true,
                lastActivityAt: true,
            },
        });
        return atRisk;
    });

    app.patch("/v2/servers/:id/lifecycle", async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = req.body as {
            tierType?: string;
            tierExpiresAt?: string;
            region?: string;
            latitude?: number;
            longitude?: number;
            role?: string;
            importance?: string;
        };

        const data: Record<string, unknown> = {};
        if (body.tierType !== undefined) data.tierType = body.tierType;
        if (body.tierExpiresAt !== undefined) data.tierExpiresAt = new Date(body.tierExpiresAt);
        if (body.region !== undefined) data.region = body.region;
        if (body.latitude !== undefined) data.latitude = body.latitude;
        if (body.longitude !== undefined) data.longitude = body.longitude;
        if (body.role !== undefined) data.role = body.role;
        if (body.importance !== undefined) data.importance = body.importance;

        const updated = await prisma.server.update({
            where: { id },
            data,
        });

        return updated;
    });

    // Feature 4: Infrastructure Migration Planner
    app.post("/v2/migrations/plan", async (req) => {
        const body = req.body as { sourceServerId: string; targetServerId: string };
        const servers = await prisma.server.findMany({
            select: { id: true, role: true, importance: true },
        });

        const { buildPlan } = await import("./lib/migration.js");
        return buildPlan(body.sourceServerId, body.targetServerId, servers as any);
    });

    // Feature 5: Prebuilt Service Catalog
    app.get("/v2/catalog", async (req) => {
        const category = (req.query as any).category as string | undefined;
        const { listServices } = await import("./lib/catalog.js");
        return listServices(category);
    });

    app.get("/v2/catalog/:slug", async (req, reply) => {
        const { slug } = req.params as { slug: string };
        const { getService } = await import("./lib/catalog.js");
        const service = getService(slug);
        if (!service) return reply.code(404).send({ error: "Service not found" });
        return service;
    });

    // Feature 6: Notification Channels
    app.post("/v2/notifications/channels", async (req, reply) => {
        const body = req.body as {
            type: "webhook" | "telegram" | "slack";
            target: string;
            secret?: string;
            events: string[];
        };

        const channel = await prisma.notificationChannel.create({
            data: {
                userId: (req as any).user?.id ?? "anonymous",
                type: body.type,
                target: body.target,
                secret: body.secret,
                events: body.events,
            },
        });

        return reply.code(201).send(channel);
    });

    app.get("/v2/notifications/channels", async (req) => {
        const userId = (req as any).user?.id ?? "anonymous";
        return prisma.notificationChannel.findMany({ where: { userId } });
    });

    // Feature 7: Drift Detection
    app.post("/v2/servers/:id/drift/baseline", async (req) => {
        const { id } = req.params as { id: string };
        const body = req.body as { manifest: unknown };
        const { storeBlueprint } = await import("./lib/drift.js");
        await storeBlueprint(id, body.manifest);
        return { status: "stored", serverId: id };
    });

    app.get("/v2/servers/:id/drift", async (req) => {
        const { id } = req.params as { id: string };
        const { detectDrift, getDriftHistory } = await import("./lib/drift.js");
        const [drift, history] = await Promise.all([detectDrift(id), getDriftHistory(id)]);
        return { ...drift, history };
    });

    // Feature 8: Ingress/Tunnel
    app.post("/v2/tunnels", async (req) => {
        const body = req.body as { serverId: string; subdomain: string; targetPort: number };
        const { registerTunnel } = await import("./lib/tunnel.js");
        return registerTunnel(body.serverId, body.subdomain, body.targetPort);
    });

    app.get("/v2/tunnels", async () => {
        const { listTunnels } = await import("./lib/tunnel.js");
        return listTunnels();
    });

    app.delete("/v2/tunnels/:subdomain", async (req, reply) => {
        const { subdomain } = req.params as { subdomain: string };
        const { deleteTunnel } = await import("./lib/tunnel.js");
        await deleteTunnel(subdomain);
        return reply.code(204).send();
    });

    // Feature 9: Lite Deploy
    app.post("/v2/lite/deploy", async (req) => {
        const body = req.body as { cwd: string; services?: string[] };
        const { liteDeploy } = await import("./lib/liteDeploy.js");
        return liteDeploy({ cwd: body.cwd, services: body.services });
    });

    app.get("/v2/lite/status", async (req) => {
        const cwd = (req.query as any).cwd as string;
        const { liteStatus } = await import("./lib/liteDeploy.js");
        return liteStatus(cwd);
    });

    app.post("/v2/lite/stop", async (req) => {
        const body = req.body as { cwd: string };
        const { liteStop } = await import("./lib/liteDeploy.js");
        await liteStop(body.cwd);
        return { status: "stopped" };
    });
}