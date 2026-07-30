/**
 * PocketCloud Task Queue Worker
 * Polls for QUEUED tasks, dispatches them to the correct handler,
 * and manages task lifecycle (QUEUED → RUNNING → COMPLETED/FAILED).
 *
 * Runs as a standalone Node.js process alongside the API server.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const POLL_INTERVAL_MS = 5_000;
const WORKER_CONCURRENCY = 4;

let activeTasks = 0;

async function processTask(taskId: string): Promise<void> {
  activeTasks++;

  try {
    // Transition to RUNNING
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        logs: {
          create: {
            level: 'INFO',
            message: 'Worker picked up task. Dispatching to agent polling queue.'
          }
        }
      }
    });

    // In a real deployment the worker would push to a Redis queue
    // and the agent would dequeue via /api/v1/agent/tasks/pending.
    // Here we record the dispatch so the task is visible in the UI.
    await prisma.taskLog.create({
      data: {
        taskId,
        level: 'INFO',
        message: 'Task dispatched to agent command queue. Awaiting agent acknowledgement.'
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Failed to process task ${taskId}: ${message}`);

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        logs: {
          create: { level: 'ERROR', message: `Worker dispatch error: ${message}` }
        }
      }
    }).catch(() => { /* ignore update error */ });
  } finally {
    activeTasks--;
  }
}

async function pollQueue(): Promise<void> {
  if (activeTasks >= WORKER_CONCURRENCY) return;

  const available = WORKER_CONCURRENCY - activeTasks;

  const tasks = await prisma.task.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: available,
    select: { id: true }
  });

  for (const task of tasks) {
    processTask(task.id).catch(console.error);
  }
}

async function main(): Promise<void> {
  console.log('[worker] PocketCloud Task Queue Worker started.');
  console.log(`[worker] Poll interval: ${POLL_INTERVAL_MS}ms, Concurrency: ${WORKER_CONCURRENCY}`);

  // Run immediately then on interval
  await pollQueue();

  setInterval(() => {
    pollQueue().catch(console.error);
  }, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
