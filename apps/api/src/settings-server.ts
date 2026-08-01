import Fastify from 'fastify';
import { z } from 'zod';
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
  } catch (err) {
    req.log.debug({ err }, 'access token verification failed');
    return reply.code(401).send({ error: 'invalid_token' });
  }
});

app.get('/api/v1/settings', async () => {
  await seedDefaultSettings(prisma, config.POCKETCLOUD_DOMAIN);
  return listSettings(prisma);
});

// Errors thrown by the settings service that map to a client mistake.
const SETTING_CLIENT_ERRORS: Record<string, number> = {
  unsupported_setting: 404,
  secret_replacement_required: 400
};

app.put('/api/v1/settings/:key', async (req, reply) => {
  const input = settingUpdateSchema.parse({ ...(req.body as object), key: (req.params as { key: string }).key });
  try {
    return await updateSetting(prisma, (req as any).auth.userId, req.ip, input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_setting_value', details: error.issues });
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = SETTING_CLIENT_ERRORS[message];
    if (status) return reply.code(status).send({ error: message });
    // Anything else (database outage, encryption failure…) is a server fault and
    // must not be reported to the caller as a bad request.
    req.log.error({ err: error }, `failed to update setting '${input.key}'`);
    return reply.code(500).send({ error: 'setting_update_failed' });
  }
});

app.get('/health', async () => ({ status: 'ok', service: 'pocketcloud-settings' }));

process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled promise rejection');
});

app.listen({ port: 8082, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});