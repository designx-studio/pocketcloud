// Feature 8: Ingress / Tunnel for NAT'd Nodes
// Registers subdomain → server:port routes via tunnel manager

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function registerTunnel(serverId: string, subdomain: string, targetPort: number) {
    return prisma.tunnelRoute.upsert({
        where: { subdomain },
        create: { serverId, subdomain, targetPort },
        update: { serverId, targetPort },
    });
}

export async function listTunnels() {
    return prisma.tunnelRoute.findMany({
        include: { server: { select: { name: true, ipAddress: true } } },
    });
}

export async function deleteTunnel(subdomain: string) {
    return prisma.tunnelRoute.delete({ where: { subdomain } }).catch(() => undefined);
}

export function buildTunnelUrl(rootDomain: string, subdomain: string): string {
    return `https://${subdomain}.${rootDomain}`;
}

export async function getTunnelsForServer(serverId: string) {
    return prisma.tunnelRoute.findMany({ where: { serverId } });
}