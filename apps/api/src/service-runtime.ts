/**
 * Shared runtime helpers for the background services (worker, scheduler, task engine).
 */
import type { PrismaClient } from '@prisma/client';

/** Prefixed logger so every background service reports consistently. */
export const serviceLogger = (name: string) => ({
  info: (message: string) => console.log(`[${name}] ${message}`),
  error: (message: string, err?: unknown) => console.error(`[${name}] ${message}`, err ?? '')
});

/** Run an interval whose handler never rejects the timer. */
export function scheduleInterval(name: string, intervalMs: number, fn: () => Promise<void>): NodeJS.Timeout {
  return setInterval(() => {
    fn().catch((err) => serviceLogger(name).error('interval error:', err instanceof Error ? err.message : err));
  }, intervalMs);
}

/** Boot a background service, exiting non-zero on an unrecoverable startup error. */
export function startService(name: string, main: () => Promise<void>): void {
  main().catch((err) => {
    serviceLogger(name).error('Fatal error:', err);
    process.exit(1);
  });
}

/** Mark a task FAILED and attach the error to its log stream. */
export async function failTask(prisma: PrismaClient, taskId: string, message: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      logs: { create: { level: 'ERROR', message } }
    }
  });
}
