/**
 * Audit logging helper.
 * Centralises the immutable audit-trail writes performed by the API surfaces so
 * metadata serialisation and optional-user handling stay consistent.
 */
import type { PrismaClient } from '@prisma/client';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      ipAddress: entry.ipAddress,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined
    }
  });
}
