/**
 * PocketCloud Task Queue Worker
 * Claims queued tasks atomically, transitions them to RUNNING, and records dispatch.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const POLL_INTERVAL_MS = 5_000;
const WORKER_CONCURRENCY = 4;
let activeTasks = 0;

async function processTask(taskId: string): Promise<void> {
  activeTasks++;
  try {
    const claimed = await prisma.task.updateMany({
      where: { id: taskId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date() }
    });
    if (claimed.count !== 1) return;
    await prisma.taskLog.create({
      data: { taskId, level: 'INFO', message: 'Task dispatched to agent command queue. Awaiting agent acknowledgement.' }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Failed to process task ${taskId}: ${message}`);
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'FAILED', finishedAt: new Date(), logs: { create: { level: 'ERROR', message: `Worker dispatch error: ${message}` } } }
    }).catch(() => undefined);
  } finally {
    activeTasks--;
  }
}

async function pollQueue(): Promise<void> {
  if (activeTasks >= WORKER_CONCURRENCY) return;
  const tasks = await prisma.task.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: WORKER_CONCURRENCY - activeTasks,
    select: { id: true }
  });
  for (const task of tasks) processTask(task.id).catch((err) => console.error('[worker] task error', err));
}

async function main(): Promise<void> {
  console.log(`[worker] PocketCloud Task Queue Worker started. Poll interval: ${POLL_INTERVAL_MS}ms, concurrency: ${WORKER_CONCURRENCY}`);
  await pollQueue();
  setInterval(() => pollQueue().catch((err) => console.error('[worker] poll error', err)), POLL_INTERVAL_MS);
}
main().catch((err) => { console.error('[worker] Fatal error:', err); process.exit(1); });
