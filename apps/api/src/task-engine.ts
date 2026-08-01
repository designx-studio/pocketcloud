/**
 * PocketCloud Task Engine
 * Handles task result reconciliation: receives completion signals from agents,
 * resolves blueprint restoration tasks, and emits audit log entries.
 *
 * This process does NOT expose HTTP. It reads from the task table and reconciles
 * any RUNNING tasks whose associated agent has gone OFFLINE (auto-fail).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RECONCILE_INTERVAL_MS = 10_000;
const TASK_TIMEOUT_MS = 600_000; // 10 minutes

async function reconcileStuckTasks(): Promise<void> {
  const cutoff = new Date(Date.now() - TASK_TIMEOUT_MS);

  // Find tasks stuck in RUNNING for > 10 minutes
  const stuck = await prisma.task.findMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: cutoff }
    },
    select: { id: true, type: true, serverId: true }
  });

  for (const task of stuck) {
    console.log(`[task-engine] Task ${task.id} (${task.type}) timed out after ${TASK_TIMEOUT_MS / 60000} min. Marking FAILED.`);
    try {
      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          logs: {
            create: {
              level: 'ERROR',
              message: `Task timed out after ${TASK_TIMEOUT_MS / 60000} minutes without agent acknowledgement. Check agent connectivity.`
            }
          }
        }
      });
    } catch (err) {
      // Keep reconciling the remaining tasks instead of aborting the sweep.
      console.error(`[task-engine] Failed to time out task ${task.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function reconcileOfflineAgentTasks(): Promise<void> {
  // Find all QUEUED/RUNNING tasks for OFFLINE servers
  const affected = await prisma.task.findMany({
    where: {
      status: { in: ['QUEUED', 'RUNNING'] },
      server: { status: 'OFFLINE' }
    },
    select: { id: true, type: true, server: { select: { name: true } } }
  });

  for (const task of affected) {
    console.log(`[task-engine] Server '${task.server.name}' is OFFLINE. Failing task ${task.id} (${task.type}).`);
    try {
      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          logs: {
            create: {
              level: 'ERROR',
              message: `Task failed: target server went OFFLINE before task could be executed.`
            }
          }
        }
      });
    } catch (err) {
      console.error(`[task-engine] Failed to fail task ${task.id} for offline server:`, err instanceof Error ? err.message : err);
    }
  }
}

async function main(): Promise<void> {
  console.log('[task-engine] PocketCloud Task Engine started.');
  console.log(`[task-engine] Task timeout: ${TASK_TIMEOUT_MS / 60000}min, Reconcile interval: ${RECONCILE_INTERVAL_MS / 1000}s`);

  await runReconciliation();
  setInterval(runReconciliation, RECONCILE_INTERVAL_MS);
}

async function runReconciliation(): Promise<void> {
  for (const sweep of [reconcileStuckTasks, reconcileOfflineAgentTasks]) {
    try {
      await sweep();
    } catch (err) {
      console.error(`[task-engine] ${sweep.name} failed:`, err instanceof Error ? err.stack ?? err.message : err);
    }
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[task-engine] Unhandled promise rejection:', reason);
});

main().catch((err) => {
  console.error('[task-engine] Fatal error:', err);
  process.exit(1);
});
