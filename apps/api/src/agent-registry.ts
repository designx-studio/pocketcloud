/**
 * PocketCloud Agent Registry
 * Serves verified, compiled agent binaries for supported Linux platforms.
 */
import Fastify from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const RELEASES_DIR = process.env.AGENT_RELEASES_DIR || '/opt/pocketcloud/agent-releases';
const AGENT_VERSION = process.env.AGENT_VERSION || '1.1.0';
const SUPPORTED_PLATFORMS: Record<string, string> = {
  'linux-x86_64': 'pocketcloud-agent-linux-x86_64',
  'linux-aarch64': 'pocketcloud-agent-linux-aarch64',
  'linux-armv7l': 'pocketcloud-agent-linux-armv7l'
};
const app = Fastify({ logger: true });

function safeReleasePath(filename: string): string | null {
  const root = resolve(RELEASES_DIR);
  const candidate = resolve(join(root, filename));
  const rel = relative(root, candidate);
  return rel && !rel.startsWith('..') && !rel.includes('/') ? candidate : null;
}

app.get('/api/v1/agent/releases', async (_req, reply) => {
  const releases = Object.entries(SUPPORTED_PLATFORMS).map(([platform, filename]) => {
    const filePath = safeReleasePath(filename);
    const available = Boolean(filePath && existsSync(filePath));
    return { platform, version: AGENT_VERSION, filename, available, sizeBytes: available ? statSync(filePath!).size : null };
  });
  return reply.send({ version: AGENT_VERSION, releases });
});

app.get<{ Params: { platform: string } }>('/api/v1/agent/releases/:platform', async (req, reply) => {
  const filename = SUPPORTED_PLATFORMS[req.params.platform];
  if (!filename) return reply.code(400).send({ error: 'unsupported_platform', supported: Object.keys(SUPPORTED_PLATFORMS) });
  const filePath = safeReleasePath(filename);
  if (!filePath || !existsSync(filePath)) {
    return reply.code(404).send({ error: 'release_not_found', message: `Agent binary for ${req.params.platform} is not available.` });
  }
  const stat = statSync(filePath);
  reply.header('Content-Type', 'application/octet-stream');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  reply.header('Content-Length', stat.size);
  reply.header('X-Agent-Version', AGENT_VERSION);
  return reply.send(createReadStream(filePath));
});

app.listen({ port: 8081, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
