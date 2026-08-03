import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { config } from './config.js';
import { hashPassword, verifyPassword, signAccess, randomToken, hashToken } from './security.js';
import { sanitizeEnvironment, parseBlueprintManifest, validateCompatibility } from '@pocketcloud/blueprint';
import { toJsonField, fromJsonField, isSQLite } from './db-compat.js';

const prisma = new PrismaClient();
const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });

// Keep IP-only HTTP deployments usable while retaining Secure cookies behind HTTPS.
const isSecureRequest = (req: any) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  return forwardedProto === 'https' || req.protocol === 'https';
};
const refreshCookieOptions = (req: any) => ({
  httpOnly: true,
  secure: isSecureRequest(req),
  sameSite: 'lax' as const,
  path: '/api/v1/auth'
});

await app.register(helmet);
await app.register(cookie);
await app.register(cors, {
  origin: (origin, cb) => {
    // Reflect the request origin back to support credentials: true
    cb(null, true);
  },
  credentials: true
});
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(swagger, { openapi: { info: { title: 'PocketCloud API', version: '1.1.0' } } });
await app.register(swaggerUi, { routePrefix: '/docs' });

// Health check endpoint
app.get('/health', async () => ({
  status: 'ok',
  service: 'pocketcloud-api',
  version: '1.1.0',
  time: new Date().toISOString()
}));

// AUTHENTICATION ENDPOINTS
app.post('/api/v1/auth/register', async (req, reply) => {
  const body = z.object({
    email: z.string().email(),
    password: z.string().min(8)
  }).parse(req.body);

  const normalizedEmail = body.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return reply.code(409).send({ error: 'account_exists' });
  }

  const passwordHash = await hashPassword(body.password);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      role: 'OWNER'
    }
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'user_register',
      resource: 'User',
      resourceId: user.id,
      ipAddress: req.ip
    }
  });

  const accessToken = await signAccess(user.id, user.role);
  const refresh = randomToken();

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + 30 * 864e5)
    }
  });

  reply.setCookie('refresh_token', refresh, refreshCookieOptions(req));

  return reply.code(201).send({
    accessToken,
    user: { id: user.id, email: user.email, role: user.role }
  });
});

app.post('/api/v1/auth/login', async (req, reply) => {
  const body = z.object({
    email: z.string().email(),
    password: z.string()
  }).parse(req.body);

  const normalizedEmail = body.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
    return reply.code(401).send({ error: 'invalid_credentials' });
  }

  const accessToken = await signAccess(user.id, user.role);
  const refresh = randomToken();

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + 30 * 864e5)
    }
  });

  reply.setCookie('refresh_token', refresh, refreshCookieOptions(req));

  return {
    accessToken,
    user: { id: user.id, email: user.email, role: user.role }
  };
});

app.post('/api/v1/auth/demo', async (_req, reply) => {
  const demoEmail = 'demo@pocketcloud.dev';
  let user = await prisma.user.findUnique({ where: { email: demoEmail } });

  if (!user) {
    const passwordHash = await hashPassword('demo-read-only-access');
    user = await prisma.user.create({
      data: {
        email: demoEmail,
        passwordHash,
        role: 'VIEWER'
      }
    });
  }

  // Seed sample demo servers & metrics if empty
  const serverCount = await prisma.server.count();
  if (serverCount === 0) {
    const s1 = await prisma.server.create({
      data: {
        name: 'demo-oracle-vps',
        provider: 'Oracle Cloud Free Tier',
        ipAddress: '152.13.44.12',
        os: 'Ubuntu 24.04 LTS',
        architecture: 'x86_64',
        environment: 'production',
        status: 'ONLINE'
      }
    });

    const s2 = await prisma.server.create({
      data: {
        name: 'demo-hetzner-node',
        provider: 'Hetzner Cloud',
        ipAddress: '95.217.34.101',
        os: 'Ubuntu 22.04 LTS',
        architecture: 'x86_64',
        environment: 'staging',
        status: 'ONLINE'
      }
    });

    // Seed metrics
    await prisma.healthMetric.createMany({
      data: [
        { serverId: s1.id, cpu: 18.5, memory: 40.2, disk: 45.0, load: 0.15, swap: 0, uptime: isSQLite() ? 86400 : (BigInt(86400) as any) },
        { serverId: s2.id, cpu: 12.0, memory: 25.4, disk: 20.1, load: 0.08, swap: 0, uptime: isSQLite() ? 172800 : (BigInt(172800) as any) }
      ]
    });

    // Seed sample blueprint
    await prisma.blueprint.create({
      data: {
        serverId: s1.id,
        name: 'web-api-stack',
        versions: {
          create: {
            version: 1,
            manifest: toJsonField({
              name: 'web-api-stack',
              os: 'ubuntu-24.04',
              provider: 'oracle-cloud-free',
              packages: ['docker.io', 'nginx', 'curl'],
              services: [{ name: 'nginx', enabled: true }, { name: 'docker', enabled: true }],
              environment: { NODE_ENV: 'production', DATABASE_URL: '[REDACTED]' }
            }) as any,
            checksum: hashToken('demo-checksum')
          }
        }
      }
    });
  }

  const accessToken = await signAccess(user.id, user.role);

  return reply.code(200).send({
    accessToken,
    user: { id: user.id, email: user.email, role: user.role }
  });
});

app.post('/api/v1/auth/refresh', async (req, reply) => {
  const token = req.cookies.refresh_token;
  if (!token) {
    return reply.code(401).send({ error: 'no_refresh_token' });
  }

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { refreshHash: tokenHash },
    include: { user: true }
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return reply.code(401).send({ error: 'invalid_or_expired_session' });
  }

  const newRefresh = randomToken();
  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshHash: hashToken(newRefresh),
      expiresAt: new Date(Date.now() + 30 * 864e5)
    }
  });

  reply.setCookie('refresh_token', newRefresh, refreshCookieOptions(req));

  const accessToken = await signAccess(session.user.id, session.user.role);

  return {
    accessToken,
    user: { id: session.user.id, email: session.user.email, role: session.user.role }
  };
});

app.post('/api/v1/auth/logout', async (req, reply) => {
  const token = req.cookies.refresh_token;
  if (token) {
    await prisma.session.updateMany({
      where: { refreshHash: hashToken(token) },
      data: { revokedAt: new Date() }
    });
  }
  reply.clearCookie('refresh_token', { path: '/api/v1/auth' });
  return { ok: true };
});

// AUTHORIZATION HOOK FOR PROTECTED ROUTES
app.addHook('preHandler', async (req, reply) => {
  const open = [
    '/health',
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/demo',
    '/api/v1/auth/refresh',
    '/api/v1/auth/logout',
    '/api/v1/agent/register',
    '/api/v1/agent/heartbeat',
    '/api/v1/agent/tasks/pending',
    '/docs'
  ];
  if (open.some(p => req.url === p || req.url.startsWith(p))) return;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const tokenStr = authHeader.slice(7);
  const isTaskActionRoute = req.url.startsWith('/api/v1/tasks/') && (req.url.endsWith('/complete') || req.url.endsWith('/logs') || req.url.includes('/complete?') || req.url.includes('/logs?'));

  try {
    const access = await (await import('./security.js')).verifyAccess(tokenStr);
    (req as any).auth = access;

    // Enforce read-only restriction for VIEWER role on mutating endpoints
    if (req.method !== 'GET' && access.role === 'VIEWER') {
      return reply.code(403).send({
        error: 'demo_account_restricted',
        message: 'This action is restricted in Demo Mode (Read-Only Account).'
      });
    }
  } catch (err) {
    if (isTaskActionRoute) {
      const tokenHash = hashToken(tokenStr);
      const agent = await prisma.agent.findUnique({
        where: { credentialHash: tokenHash },
        include: { server: true }
      });
      if (agent) {
        (req as any).agent = agent;
        return;
      }
    }
    return reply.code(401).send({ error: 'invalid_token' });
  }
});

app.get('/api/v1/auth/me', async (req) => {
  const auth = (req as any).auth;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) throw new Error('user_not_found');
  return { id: user.id, email: user.email, role: user.role };
});

const getAgentInstallCommand = (req: any, token: string): string => {
  let appUrl = config.APP_URL?.trim();

  // If APP_URL is missing or contains placeholder host, fall back dynamically to request headers
  const isPlaceholder = !appUrl || /your-domain|example\.com|localhost|127\.0\.0\.1/i.test(appUrl);

  if (isPlaceholder && req?.headers) {
    const headers: any = req.headers;
    const rawHost = String(headers['x-forwarded-host'] || headers['host'] || '');
    const firstHost = rawHost.split(',')[0] ?? '';
    const host = firstHost.trim();
    if (host) {
      const protoHeader = headers['x-forwarded-proto'];
      const rawProto = protoHeader ? String(protoHeader).split(',')[0] ?? '' : '';
      const forwardedProto = rawProto.trim() || undefined;
      const hostPart = (host.split(':')[0] ?? '').trim();
      const isIPOrLocalhost = hostPart === 'localhost' || /^[0-9.]+$/.test(hostPart);
      const scheme = forwardedProto || (isIPOrLocalhost ? 'http' : 'https');
      appUrl = `${scheme}://${host}`;
    }
  }

  if (!appUrl) {
    appUrl = 'http://localhost:8080';
  }

  appUrl = appUrl.replace(/\/+$/, '');
  return `curl -fsSL ${appUrl}/install-agent.sh | bash -s -- --token ${token} --control-plane ${appUrl}`;
};

// SERVER NODES MANAGEMENT
app.get('/api/v1/servers', async () => {
  const servers = await prisma.server.findMany({
    include: {
      agent: true,
      metrics: { orderBy: { collectedAt: 'desc' }, take: 1 }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  // Convert BigInt fields to Number for JSON serialization
  return servers.map((server: any) => ({
    ...server,
    metrics: server.metrics.map((m: any) => ({
      ...m,
      uptime: m.uptime ? Number(m.uptime) : null
    }))
  }));
});

app.post('/api/v1/servers', async (req, reply) => {
  const body = z.object({
    name: z.string().min(1).max(100),
    provider: z.string().min(1),
    ipAddress: z.string(),
    os: z.string(),
    architecture: z.string().optional(),
    environment: z.string().optional()
  }).parse(req.body);

  const rawToken = randomToken();
  const server = await prisma.server.create({
    data: {
      ...body,
      status: 'PENDING',
      bootstrapTokens: {
        create: {
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 60 * 60e3) // 1 hour
        }
      }
    }
  });

  const auth = (req as any).auth;
  await prisma.auditLog.create({
    data: {
      userId: auth?.userId || null,
      action: 'server_create',
      resource: 'Server',
      resourceId: server.id,
      ipAddress: req.ip,
      metadata: JSON.stringify({ name: server.name, provider: server.provider })
    }
  });

  return reply.code(201).send({
    server,
    bootstrapToken: rawToken,
    installCommand: getAgentInstallCommand(req, rawToken)
  });
});

app.post('/api/v1/servers/:id/bootstrap-token', async (req, reply) => {
  const id = (req.params as any).id;
  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) return reply.code(404).send({ error: 'server_not_found' });

  await prisma.bootstrapToken.deleteMany({
    where: { serverId: id }
  });

  const rawToken = randomToken();
  await prisma.bootstrapToken.create({
    data: {
      serverId: id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60e3)
    }
  });

  return {
    bootstrapToken: rawToken,
    installCommand: getAgentInstallCommand(req, rawToken)
  };
});

app.get('/api/v1/servers/:id', async (req, reply) => {
  const id = (req.params as any).id;
  const server = await prisma.server.findUnique({
    where: { id },
    include: {
      agent: true,
      metrics: { orderBy: { collectedAt: 'desc' }, take: 20 },
      tasks: { orderBy: { createdAt: 'desc' }, take: 10 },
      blueprints: true
    }
  });

  if (!server) return reply.code(404).send({ error: 'server_not_found' });
  return server;
});

app.patch('/api/v1/servers/:id', async (req, reply) => {
  const id = (req.params as any).id;
  const body = z.object({
    name: z.string().min(1).max(100).optional(),
    provider: z.string().optional(),
    ipAddress: z.string().optional(),
    os: z.string().optional(),
    architecture: z.string().optional(),
    environment: z.string().optional(),
    status: z.enum(['PENDING', 'ONLINE', 'OFFLINE', 'ERROR']).optional()
  }).parse(req.body);

  const server = await prisma.server.update({
    where: { id },
    data: body,
    include: { agent: true }
  });
  return server;
});

app.delete('/api/v1/servers/:id', async (req, reply) => {
  const id = (req.params as any).id;
  const auth = (req as any).auth;
  
  const server = await prisma.server.findUnique({ where: { id } });
  if (server) {
    await prisma.auditLog.create({
      data: {
        userId: auth?.userId || null,
        action: 'server_delete',
        resource: 'Server',
        resourceId: id,
        ipAddress: req.ip,
        metadata: JSON.stringify({ name: server.name, provider: server.provider })
      }
    });
    await prisma.server.delete({ where: { id } });
  }
  return reply.code(200).send({ ok: true, id });
});

app.get('/api/v1/servers/:id/metrics', async (req, reply) => {
  const id = (req.params as any).id;
  const { limit = '60' } = req.query as { limit?: string };
  const n = Math.min(parseInt(limit, 10) || 60, 1440); // max 24h of minute-level data

  const metrics = await prisma.healthMetric.findMany({
    where: { serverId: id },
    orderBy: { collectedAt: 'desc' },
    take: n,
    select: { cpu: true, memory: true, disk: true, load: true, swap: true, uptime: true, collectedAt: true }
  });

  // Return in ascending time order for charting
  return metrics.reverse().map((m: any) => ({
    ...m,
    uptime: Number(m.uptime) // BigInt → number for JSON serialisation
  }));
});

app.get('/api/v1/servers/:id/logs', async (req, reply) => {
  const id = (req.params as any).id;
  const { limit = '50' } = req.query as { limit?: string };
  const n = Math.min(parseInt(limit, 10) || 50, 500);

  const heartbeats = await prisma.heartbeat.findMany({
    where: { serverId: id },
    orderBy: { receivedAt: 'desc' },
    take: n,
    select: { payload: true, receivedAt: true }
  });

  return heartbeats.map((h: any) => ({
    receivedAt: h.receivedAt,
    payload: h.payload
  }));
});

// AGENT PAIRING & TELEMETRY
app.post('/api/v1/agent/register', async (req, reply) => {
  const body = z.object({
    bootstrapToken: z.string(),
    publicKey: z.string().optional(),
    version: z.string().optional()
  }).parse(req.body);

  const tokenRecord = await prisma.bootstrapToken.findUnique({
    where: { tokenHash: hashToken(body.bootstrapToken) },
    include: { server: true }
  });

  if (!tokenRecord || tokenRecord.expiresAt < new Date() || tokenRecord.usedAt) {
    return reply.code(401).send({ error: 'invalid_or_expired_bootstrap_token' });
  }

  const agentCredential = randomToken();
  const credentialHash = hashToken(agentCredential);

  const agent = await prisma.agent.create({
    data: {
      serverId: tokenRecord.serverId,
      version: body.version || '1.1.0',
      publicKey: body.publicKey,
      credentialHash,
      connectedAt: new Date(),
      lastSeenAt: new Date()
    }
  });

  await prisma.bootstrapToken.update({
    where: { id: tokenRecord.id },
    data: { usedAt: new Date() }
  });

  await prisma.server.update({
    where: { id: tokenRecord.serverId },
    data: { status: 'ONLINE' }
  });

  return reply.code(201).send({
    agentId: agent.id,
    serverId: agent.serverId,
    credentialToken: agentCredential
  });
});

app.post('/api/v1/agent/heartbeat', async (req, reply) => {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return reply.code(401).send({ error: 'missing_agent_token' });

  const agent = await prisma.agent.findUnique({
    where: { credentialHash: hashToken(auth) },
    include: { server: true }
  });

  if (!agent) return reply.code(401).send({ error: 'invalid_agent_token' });

  const payload = z.object({
    cpu: z.number().optional(),
    memory: z.number().optional(),
    disk: z.number().optional(),
    load: z.number().optional(),
    swap: z.number().optional(),
    uptime: z.number().optional(),
    os: z.string().optional(),
    architecture: z.string().optional()
  }).passthrough().parse(req.body);

  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agent.id },
      data: { lastSeenAt: new Date() }
    }),
    prisma.server.update({
      where: { id: agent.serverId },
      data: { status: 'ONLINE' }
    }),
    prisma.heartbeat.create({
      data: { serverId: agent.serverId, payload: toJsonField(payload) as any }
    }),
    ...(payload.cpu !== undefined && payload.memory !== undefined && payload.disk !== undefined
      ? [
          prisma.healthMetric.create({
            data: {
              serverId: agent.serverId,
              cpu: payload.cpu,
              memory: payload.memory,
              disk: payload.disk,
              load: payload.load ?? 0,
              swap: payload.swap ?? 0,
              uptime: isSQLite() ? Math.floor(payload.uptime ?? 0) : (BigInt(payload.uptime ?? 0) as any)
            }
          })
        ]
      : [])
  ]);

  return { ok: true, intervalSeconds: 10 };
});

// AGENT TASK POLLING (no user JWT — uses agent credential)
app.get('/api/v1/agent/tasks/pending', async (req, reply) => {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return reply.code(401).send({ error: 'missing_agent_token' });

  const agent = await prisma.agent.findUnique({
    where: { credentialHash: hashToken(auth) },
    include: { server: true }
  });
  if (!agent) return reply.code(401).send({ error: 'invalid_agent_token' });

  // Update agent last seen
  await prisma.agent.update({
    where: { id: agent.id },
    data: { lastSeenAt: new Date() }
  });

  const tasks = await prisma.task.findMany({
    where: {
      serverId: agent.serverId,
      status: { in: ['QUEUED', 'RUNNING'] }
    },
    orderBy: { createdAt: 'asc' },
    take: 5
  });

  // Ensure payload is properly deserialized for both SQLite and PostgreSQL
  return tasks.map(task => ({
    ...task,
    payload: fromJsonField(task.payload)
  }));
});

// TASK ENGINE ENDPOINTS
app.get('/api/v1/tasks', async () => {
  const tasks = await prisma.task.findMany({
    include: { server: true, logs: true },
    orderBy: { createdAt: 'desc' }
  });
  // Ensure payload is properly deserialized for both SQLite and PostgreSQL
  return tasks.map(task => ({
    ...task,
    payload: fromJsonField(task.payload)
  }));
});

app.post('/api/v1/tasks', async (req, reply) => {
  const body = z.object({
    serverId: z.string(),
    type: z.enum([
      'install_docker',
      'update_packages',
      'restart_service',
      'collect_logs',
      'update_agent',
      'restart_server',
      'reboot',
      'shutdown',
      'restore_blueprint'
    ]),
    payload: z.record(z.unknown()).default({})
  }).parse(req.body);

  const auth = (req as any).auth;
  const task = await prisma.task.create({
    data: {
      serverId: body.serverId,
      type: body.type,
      payload: toJsonField(body.payload) as any,
      status: 'QUEUED',
      requestedBy: auth.userId,
      logs: {
        create: {
          level: 'INFO',
          message: `Task ${body.type} created and queued for execution.`
        }
      }
    },
    include: { logs: true }
  });

  await prisma.auditLog.create({
    data: {
      userId: auth.userId,
      action: 'task_dispatch',
      resource: 'Task',
      resourceId: task.id,
      ipAddress: req.ip,
      metadata: JSON.stringify({ type: task.type, serverId: task.serverId })
    }
  });

  // Ensure payload is properly deserialized for both SQLite and PostgreSQL
  return reply.code(202).send({
    ...task,
    payload: fromJsonField(task.payload)
  });
});

app.get('/api/v1/tasks/:id', async (req, reply) => {
  const id = (req.params as any).id;
  const task = await prisma.task.findUnique({
    where: { id },
    include: { logs: { orderBy: { createdAt: 'asc' } }, server: true }
  });

  if (!task) return reply.code(404).send({ error: 'task_not_found' });
  // Ensure payload is properly deserialized for both SQLite and PostgreSQL
  return {
    ...task,
    payload: fromJsonField(task.payload)
  };
});

app.post('/api/v1/tasks/:id/logs', async (req, reply) => {
  const taskId = (req.params as any).id;
  const body = z.object({
    level: z.string().default('INFO'),
    message: z.string()
  }).parse(req.body);

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return reply.code(404).send({ error: 'task_not_found' });

  const agent = (req as any).agent;
  if (agent && agent.serverId !== task.serverId) {
    return reply.code(403).send({ error: 'forbidden', message: 'Agent not authorized for this server\'s tasks.' });
  }

  const log = await prisma.taskLog.create({
    data: { taskId, level: body.level, message: body.message }
  });

  return reply.code(201).send(log);
});

app.post('/api/v1/tasks/:id/complete', async (req, reply) => {
  const id = (req.params as any).id;
  const body = z.object({
    status: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
    message: z.string().optional()
  }).parse(req.body);

  const existingTask = await prisma.task.findUnique({ where: { id } });
  if (!existingTask) return reply.code(404).send({ error: 'task_not_found' });

  const agent = (req as any).agent;
  if (agent && agent.serverId !== existingTask.serverId) {
    return reply.code(403).send({ error: 'forbidden', message: 'Agent not authorized for this server\'s tasks.' });
  }

  const task = await prisma.task.update({
    where: { id },
    data: {
      status: body.status as any,
      finishedAt: new Date(),
      ...(body.message ? { logs: { create: { level: body.status === 'COMPLETED' ? 'INFO' : 'ERROR', message: body.message } } } : {})
    },
    include: { logs: true }
  });

  await prisma.auditLog.create({
    data: {
      userId: (req as any).auth?.userId || null,
      action: `task_complete_${body.status.toLowerCase()}`,
      resource: 'Task',
      resourceId: task.id,
      ipAddress: req.ip,
      metadata: JSON.stringify({ message: body.message, agentId: agent?.id })
    }
  });

  // Ensure payload is properly deserialized for both SQLite and PostgreSQL
  return reply.code(200).send({
    ...task,
    payload: fromJsonField(task.payload)
  });
});

// BLUEPRINTS ENGINE ENDPOINTS
app.get('/api/v1/blueprints', async () => {
  return prisma.blueprint.findMany({
    include: {
      versions: { orderBy: { version: 'desc' }, take: 1 },
      server: true
    },
    orderBy: { updatedAt: 'desc' }
  });
});

app.post('/api/v1/blueprints', async (req, reply) => {
  const body = z.object({
    serverId: z.string(),
    name: z.string().min(1).max(120),
    manifest: z.record(z.unknown())
  }).parse(req.body);

  const sanitized = sanitizeEnvironment(body.manifest);
  const validated = parseBlueprintManifest(sanitized);
  const checksum = hashToken(JSON.stringify(validated));

  const blueprint = await prisma.blueprint.create({
    data: {
      serverId: body.serverId,
      name: body.name,
      versions: {
        create: {
          version: 1,
          manifest: toJsonField(validated) as any,
          checksum
        }
      }
    },
    include: { versions: true }
  });

  const auth = (req as any).auth;
  await prisma.auditLog.create({
    data: {
      userId: auth?.userId || null,
      action: 'blueprint_create',
      resource: 'Blueprint',
      resourceId: blueprint.id,
      ipAddress: req.ip,
      metadata: JSON.stringify({ name: blueprint.name, serverId: blueprint.serverId })
    }
  });

  return reply.code(201).send(blueprint);
});

app.post('/api/v1/blueprints/restore', async (req, reply) => {
  const body = z.object({
    blueprintVersionId: z.string(),
    targetServerId: z.string()
  }).parse(req.body);

  const version = await prisma.blueprintVersion.findUnique({
    where: { id: body.blueprintVersionId },
    include: { blueprint: true }
  });

  if (!version) return reply.code(404).send({ error: 'blueprint_version_not_found' });

  const targetServer = await prisma.server.findUnique({
    where: { id: body.targetServerId }
  });

  if (!targetServer || targetServer.status !== 'ONLINE') {
    return reply.code(409).send({ error: 'target_server_not_online' });
  }

  const manifest = parseBlueprintManifest(version.manifest);
  const compat = validateCompatibility(manifest, targetServer.os);

  const auth = (req as any).auth;
  const task = await prisma.task.create({
    data: {
      serverId: targetServer.id,
      type: 'restore_blueprint',
      payload: toJsonField({
        blueprintVersionId: version.id,
        manifest: manifest as any,
        compatibilityWarnings: compat.warnings
      }) as any,
      status: 'QUEUED',
      requestedBy: auth.userId,
      logs: {
        create: {
          level: 'INFO',
          message: `Restoration task queued for target node '${targetServer.name}'. Warnings: ${compat.warnings.length}`
        }
      }
    },
    include: { logs: true }
  });

  await prisma.auditLog.create({
    data: {
      userId: auth.userId,
      action: 'blueprint_restore',
      resource: 'Blueprint',
      resourceId: version.blueprintId,
      ipAddress: req.ip,
      metadata: JSON.stringify({ blueprintVersionId: version.id, targetServerId: targetServer.id, taskId: task.id })
    }
  });

  return reply.code(202).send({ taskId: task.id, status: task.status, warnings: compat.warnings });
});

// DIAGNOSTICS & AI LOG SANITIZER
app.post('/api/v1/diagnostics/ai', async (req, reply) => {
  const body = z.object({
    rawLogs: z.string().default('')
  }).parse(req.body);

  const sanitized = body.rawLogs
    .replace(/(password|secret|token|credential|api_key)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/bearer\s+([^\s]+)/gi, 'Bearer [REDACTED]');

  const rules: string[] = [];
  if (/restart|failed|error/i.test(sanitized)) {
    rules.push('Detected repeated process restarts. Verify memory limits and service config.');
  }
  if (/disk|full|space/i.test(sanitized)) {
    rules.push('Detected potential disk storage threshold warnings.');
  }
  if (rules.length === 0) {
    rules.push('All sanitized log streams operating nominal within threshold parameters.');
  }

  return {
    sanitizedLogs: sanitized,
    diagnosticResults: rules
  };
});

// BACKUP & DISASTER RECOVERY EXPORT/IMPORT
app.get('/api/v1/backups/export', async (req, reply) => {
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, createdAt: true } });
  const servers = await prisma.server.findMany({ include: { agent: true } });
  const blueprints = await prisma.blueprint.findMany({ include: { versions: true } });

  const backupData = {
    version: '1.1.0',
    exportedAt: new Date().toISOString(),
    users,
    servers,
    blueprints
  };

  const auth = (req as any).auth;
  await prisma.auditLog.create({
    data: {
      userId: auth?.userId || null,
      action: 'backup_export',
      resource: 'Backup',
      ipAddress: req.ip,
      metadata: JSON.stringify({ serverCount: servers.length, blueprintCount: blueprints.length })
    }
  });

  reply.header('Content-Type', 'application/json');
  reply.header('Content-Disposition', `attachment; filename="pocketcloud-backup-${Date.now()}.json"`);
  return backupData;
});

app.post('/api/v1/backups/import', async (req, reply) => {
  const serverSchema = z.object({
    id: z.string().optional(),
    name: z.string(),
    provider: z.string(),
    ipAddress: z.string(),
    os: z.string(),
    architecture: z.string().optional(),
    environment: z.string().optional()
  });

  const body = z.object({
    servers: z.array(serverSchema).default([]),
    blueprints: z.array(z.object({
      name: z.string(),
      serverId: z.string().optional(),
      manifest: z.record(z.unknown()).optional()
    })).default([])
  }).parse(req.body);

  let importedServers = 0;
  let importedBlueprints = 0;

  // Upsert servers — if id exists try update, otherwise create
  for (const s of body.servers) {
    try {
      if (s.id) {
        await prisma.server.upsert({
          where: { id: s.id },
          update: { name: s.name, provider: s.provider, ipAddress: s.ipAddress, os: s.os, architecture: s.architecture, environment: s.environment },
          create: { id: s.id, name: s.name, provider: s.provider, ipAddress: s.ipAddress, os: s.os, architecture: s.architecture, environment: s.environment, status: 'OFFLINE' }
        });
      } else {
        await prisma.server.create({
          data: { name: s.name, provider: s.provider, ipAddress: s.ipAddress, os: s.os, architecture: s.architecture, environment: s.environment, status: 'OFFLINE' }
        });
      }
      importedServers++;
    } catch { /* skip duplicates */ }
  }

  // Import blueprints (require a valid serverId or skip)
  for (const b of body.blueprints) {
    const targetServerId = b.serverId || (await prisma.server.findFirst({ select: { id: true } }))?.id;
    if (!targetServerId) continue;
    try {
      await prisma.blueprint.create({
        data: {
          name: b.name,
          serverId: targetServerId,
          versions: b.manifest ? {
            create: {
              version: 1,
              manifest: b.manifest as any,
              checksum: hashToken(JSON.stringify(b.manifest))
            }
          } : undefined
        }
      });
      importedBlueprints++;
    } catch { /* skip duplicates */ }
  }

  const auth = (req as any).auth;
  await prisma.auditLog.create({
    data: {
      userId: auth?.userId || null,
      action: 'backup_import',
      resource: 'Backup',
      ipAddress: req.ip,
      metadata: JSON.stringify({ importedServers, importedBlueprints })
    }
  });

  return reply.code(200).send({
    ok: true,
    importedServers,
    importedBlueprints,
    timestamp: new Date().toISOString()
  });
});

app.setErrorHandler((error, req, reply) => {
  req.log.error(error);
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'validation_error', details: error.issues });
  }
  return reply.code(500).send({ error: 'internal_error', message: error.message });
});

app.listen({ port: config.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
