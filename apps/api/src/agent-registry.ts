/**
 * PocketCloud Agent Registry
 * Serves compiled agent binaries for the supported platforms.
 * Called by install-agent.sh: GET /api/v1/agent/releases/:platform
 *
 * Also provides a manifest endpoint listing available releases.
 *
 * In production, binaries are stored in /opt/pocketcloud/agent-releases/
 * and are built via the CI pipeline + uploaded to the control plane.
 *
 * Note: This module's HTTP server MUST run behind the same Caddy proxy
 * as the main API (port 8081). Caddy routes /api/v1/agent/releases/* here.
 */

import Fastify from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.js';

const RELEASES_DIR = process.env.AGENT_RELEASES_DIR || '/opt/pocketcloud/agent-releases';
const AGENT_VERSION = process.env.AGENT_VERSION || '1.1.0';

const SUPPORTED_PLATFORMS: Record<string, string> = {
  'linux-x86_64':  'pocketcloud-agent-linux-x86_64',
  'linux-aarch64': 'pocketcloud-agent-linux-aarch64',
  'linux-armv7l':  'pocketcloud-agent-linux-armv7l'
};

const app = Fastify({ logger: true });

/** GET /api/v1/agent/releases — List available binary releases */
app.get('/api/v1/agent/releases', async (_req, reply) => {
  const available = Object.entries(SUPPORTED_PLATFORMS).map(([platform, filename]) => {
    const filePath = join(RELEASES_DIR, filename);
    const available = existsSync(filePath);
    return {
      platform,
      version: AGENT_VERSION,
      filename,
      available,
      sizeBytes: available ? statSync(filePath).size : null
    };
  });

  return reply.send({ version: AGENT_VERSION, releases: available });
});

/** GET /api/v1/agent/releases/:platform — Download binary for platform */
app.get<{ Params: { platform: string } }>(
  '/api/v1/agent/releases/:platform',
  async (req, reply) => {
    const { platform } = req.params;

    if (!SUPPORTED_PLATFORMS[platform]) {
      return reply.code(400).send({
        error: 'unsupported_platform',
        supported: Object.keys(SUPPORTED_PLATFORMS)
      });
    }

    const filename = SUPPORTED_PLATFORMS[platform];
    // Resolve and verify the path is within RELEASES_DIR (path traversal guard)
    const filePath = resolve(join(RELEASES_DIR, filename));
    if (!filePath.startsWith(resolve(RELEASES_DIR))) {
      return reply.code(400).send({ error: 'invalid_path' });
    }

    if (!existsSync(filePath)) {
      return reply.code(404).send({
        error: 'release_not_found',
        message: `Agent binary for ${platform} is not available on this control plane. Build and upload using: scripts/build-agent.sh`
      });
    }

    const stat = statSync(filePath);

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', stat.size);
    reply.header('X-Agent-Version', AGENT_VERSION);

    return reply.send(createReadStream(filePath));
  }
);

const PORT = 8081;

app.listen({ port: PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
