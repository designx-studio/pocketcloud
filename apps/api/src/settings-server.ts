import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { verifyAccess } from './security.js';
import { listSettings, seedDefaultSettings, settingUpdateSchema, updateSetting } from './settings-service.js';
import { config } from './config.js';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

app.addHook('preHandler', async (req, reply) => {
  if (req.url === '/health') return;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' });
  try {
    const auth = await verifyAccess(header.slice(7));
    if (auth.role === 'VIEWER') return reply.code(403).send({ error: 'forbidden', message: 'Administrator access is required.' });
    (req as any).auth = auth;
  } catch {
    return reply.code(401).send({ error: 'invalid_token' });
  }
});

app.get('/api/v1/settings', async () => {
  await seedDefaultSettings(prisma, config.POCKETCLOUD_DOMAIN);
  return listSettings(prisma);
});

app.put('/api/v1/settings/:key', async (req, reply) => {
  const input = settingUpdateSchema.parse({ ...(req.body as object), key: (req.params as { key: string }).key });
  try {
    return await updateSetting(prisma, (req as any).auth.userId, req.ip, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_setting';
    return reply.code(message === 'unsupported_setting' ? 404 : 400).send({ error: message });
  }
});

app.get('/health', async () => ({ status: 'ok', service: 'pocketcloud-settings' }));

app.listen({ port: 8082, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});