// Feature 6: Notification Layer
// Central dispatcher — one function, called from wherever events originate

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function notify(event: string, payload: Record<string, unknown>) {
    try {
        const channels = await prisma.notificationChannel.findMany({
            where: { events: { has: event } },
        });

        await Promise.allSettled(channels.map((channel) => dispatch(channel, event, payload)));
    } catch (err) {
        // Notifications should never break the calling flow
        console.error(`[notify] Failed to dispatch event ${event}:`, err);
    }
}

interface NotificationChannelRow {
    id: string;
    type: string;
    target: string;
    secret: string | null;
    events: string[];
}

async function dispatch(channel: NotificationChannelRow, event: string, payload: Record<string, unknown>) {
    const body = formatMessage(event, payload);

    switch (channel.type) {
        case "webhook":
            return fetchWithRetry(channel.target, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ event, ...payload }),
            });
        case "telegram":
            return fetchWithRetry(
                `https://api.telegram.org/bot${channel.secret}/sendMessage`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: channel.target, text: body, parse_mode: "HTML" }),
                },
            );
        case "slack":
            return fetchWithRetry(channel.target, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: body }),
            });
        default:
            console.warn(`[notify] Unknown channel type: ${channel.type}`);
    }
}

function formatMessage(event: string, payload: Record<string, unknown>): string {
    const name = (payload.name as string) || (payload.serverId as string) || "unknown";
    switch (event) {
        case "server.offline":
            return `⚠️ Server <b>${name}</b> went offline`;
        case "server.online":
            return `✅ Server <b>${name}</b> came online`;
        case "task.failed":
            return `❌ Task <b>${payload.type || "unknown"}</b> failed on <b>${name}</b>`;
        case "task.completed":
            return `✅ Task <b>${payload.type || "unknown"}</b> completed on <b>${name}</b>`;
        case "lifecycle.at_risk":
            return `🔴 Server <b>${name}</b> is AT RISK — ${payload.policy || "reclamation risk detected"}`;
        case "lifecycle.watch":
            return `🟡 Server <b>${name}</b> is under WATCH — expiry approaching`;
        case "drift.detected":
            return `🔀 Configuration drift detected on <b>${name}</b>`;
        case "backup.failed":
            return `❌ Backup failed on <b>${name}</b>`;
        case "backup.complete":
            return `✅ Backup completed on <b>${name}</b>`;
        default:
            return `📋 ${event}: ${JSON.stringify(payload)}`;
    }
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, init);
            if (res.ok) return;
            if (res.status >= 400 && res.status < 500) return; // don't retry client errors
        } catch {
            // retry
        }
        await new Promise((resolve) => setTimeout(resolve, 2 ** i * 1000));
    }
}