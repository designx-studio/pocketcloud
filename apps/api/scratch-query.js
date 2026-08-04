import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('--- LATEST AUDIT LOGS ---');
  const auditLogs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15
  });
  console.log(JSON.stringify(auditLogs, null, 2));

  console.log('--- LATEST TASKS ---');
  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: { logs: true }
  });
  console.log(JSON.stringify(tasks, null, 2));
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
