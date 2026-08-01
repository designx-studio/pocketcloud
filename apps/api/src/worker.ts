/**
 * PocketCloud Task Queue Worker
 * Claims queued tasks atomically, transitions them to RUNNING, and records dispatch.
 */
import { PrismaClient } from '@prisma/client';
import { failTask, scheduleInterval, serviceLogger, startService } from './service-runtime.js';

const prisma = new PrismaClient();
const log = serviceLogger('worker');
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
    log.error(`Failed to process task ${taskId}: ${message}`);
    await failTask(prisma, taskId, `Worker dispatch error: ${message}`).catch(() => undefined);
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
  for (const task of tasks) processTask(task.id).catch((err) => log.error('task error', err));
}

startService('worker', async () => {
  log.info(`PocketCloud Task Queue Worker started. Poll interval: ${POLL_INTERVAL_MS}ms, concurrency: ${WORKER_CONCURRENCY}`);
  await pollQueue();
  scheduleInterval('worker', POLL_INTERVAL_MS, pollQueue);
});
