/**
 * PocketCloud Scheduler
 * Runs periodic cron-like jobs:
 *   - Marks agents OFFLINE when last heartbeat > 30s ago
 *   - Cleans up expired bootstrap tokens
 *   - Prunes stale heartbeat records (> 7 days)
 *   - Prunes old health metrics (> 30 days, keeps daily aggregates)
 */

import { PrismaClient } from '@prisma/client';
import { scheduleInterval, serviceLogger, startService } from './service-runtime.js';

const prisma = new PrismaClient();
const log = serviceLogger('scheduler');

const JOBS: Array<{ name: string; intervalMs: number; fn: () => Promise<void> }> = [
  {
    name: 'offline-detection',
    intervalMs: 15_000,
    fn: async () => {
      const threshold = new Date(Date.now() - 30_000); // 30s
      const result = await prisma.server.updateMany({
        where: {
          status: 'ONLINE',
          agent: {
            lastSeenAt: { lt: threshold }
          }
        },
        data: { status: 'OFFLINE' }
      });
      if (result.count > 0) {
        log.info(`offline-detection: Marked ${result.count} server(s) OFFLINE.`);
      }
    }
  },
  {
    name: 'bootstrap-token-cleanup',
    intervalMs: 60_000,
    fn: async () => {
      const result = await prisma.bootstrapToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { usedAt: { not: null } }
          ]
        }
      });
      if (result.count > 0) {
        log.info(`bootstrap-token-cleanup: Deleted ${result.count} expired/used tokens.`);
      }
    }
  },
  {
    name: 'heartbeat-pruner',
    intervalMs: 3_600_000, // 1 hour
    fn: async () => {
      const cutoff = new Date(Date.now() - 7 * 86_400_000); // 7 days
      const result = await prisma.heartbeat.deleteMany({
        where: { receivedAt: { lt: cutoff } }
      });
      if (result.count > 0) {
        log.info(`heartbeat-pruner: Deleted ${result.count} old heartbeat records.`);
      }
    }
  },
  {
    name: 'metrics-pruner',
    intervalMs: 86_400_000, // 24 hours
    fn: async () => {
      const cutoff = new Date(Date.now() - 30 * 86_400_000); // 30 days
      const result = await prisma.healthMetric.deleteMany({
        where: { collectedAt: { lt: cutoff } }
      });
      if (result.count > 0) {
        log.info(`metrics-pruner: Deleted ${result.count} old health metrics.`);
      }
    }
  },
  {
    name: 'session-cleanup',
    intervalMs: 3_600_000, // 1 hour
    fn: async () => {
      const result = await prisma.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { revokedAt: { not: null } }
          ]
        }
      });
      if (result.count > 0) {
        log.info(`session-cleanup: Deleted ${result.count} expired/revoked sessions.`);
      }
    }
  }
];

startService('scheduler', async () => {
  log.info('PocketCloud Scheduler started.');

  // Run all jobs immediately on startup
  for (const job of JOBS) {
    await job.fn().catch((err) => log.error(`${job.name}: Error:`, err instanceof Error ? err.message : err));
  }

  // Register recurring intervals
  for (const job of JOBS) {
    scheduleInterval(`scheduler/${job.name}`, job.intervalMs, job.fn);
    log.info(`Registered job '${job.name}' every ${job.intervalMs / 1000}s`);
  }
});
