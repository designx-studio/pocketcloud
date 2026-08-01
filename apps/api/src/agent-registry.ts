/**
 * PocketCloud Agent Registry
 * Serves verified, compiled agent binaries for supported Linux platforms.
 * Falls back to GitHub releases if local binaries are not available.
 */
import Fastify from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import https from 'node:https';

const RELEASES_DIR = process.env.AGENT_RELEASES_DIR || '/opt/pocketcloud/agent-releases';
const AGENT_VERSION = process.env.AGENT_VERSION || '1.1.0';
const GITHUB_REPO = process.env.GITHUB_REPO || 'designx-studio/pocketcloud';
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

function getGitHubReleaseUrl(platform: string): string {
  const filename = SUPPORTED_PLATFORMS[platform];
  // Use the direct download URL which doesn't require redirects
  return `https://github.com/${GITHUB_REPO}/releases/download/v${AGENT_VERSION}/${filename}`;
}

app.get('/api/v1/agent/releases', async (_req, reply) => {
  const releases = Object.entries(SUPPORTED_PLATFORMS).map(([platform, filename]) => {
    const filePath = safeReleasePath(filename);
    const available = Boolean(filePath && existsSync(filePath));
    return {
      platform,
      version: AGENT_VERSION,
      filename,
      available,
      sizeBytes: available ? statSync(filePath!).size : null,
      githubUrl: getGitHubReleaseUrl(platform)
    };
  });
  return reply.send({ version: AGENT_VERSION, releases });
});

app.get<{ Params: { platform: string } }>('/api/v1/agent/releases/:platform', async (req, reply) => {
  const filename = SUPPORTED_PLATFORMS[req.params.platform];
  if (!filename) return reply.code(400).send({ error: 'unsupported_platform', supported: Object.keys(SUPPORTED_PLATFORMS) });

  // Try local file first
  const filePath = safeReleasePath(filename);
  if (filePath && existsSync(filePath)) {
    const stat = statSync(filePath);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', stat.size);
    reply.header('X-Agent-Version', AGENT_VERSION);
    reply.header('X-Agent-Source', 'local');
    return reply.send(createReadStream(filePath));
  }

  // Fall back to GitHub releases
  const githubUrl = getGitHubReleaseUrl(req.params.platform);
  app.log.info(`Local binary not found for ${req.params.platform}, proxying from GitHub: ${githubUrl}`);

  return new Promise<void>((resolve) => {
    const failRequest = (message: string) => {
      app.log.error(`GitHub proxy error: ${message}`);
      if (reply.raw.headersSent || reply.raw.writableEnded) {
        // The download already started; abort it so the client sees a truncated
        // transfer instead of silently receiving a partial binary.
        reply.raw.destroy(new Error(message));
      } else {
        reply.code(502).send({ error: 'github_release_failed', message });
      }
      resolve();
    };

    https.get(githubUrl, (githubRes: any) => {
      if (githubRes.statusCode !== 200) {
        githubRes.resume();
        failRequest(`GitHub returned ${githubRes.statusCode}`);
        return;
      }

      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('X-Agent-Version', AGENT_VERSION);
      reply.header('X-Agent-Source', 'github');
      if (githubRes.headers['content-length']) {
        reply.header('Content-Length', githubRes.headers['content-length']);
      }

      githubRes.pipe(reply.raw);
      githubRes.on('end', resolve);
      githubRes.on('error', (err: Error) => failRequest(err.message));
    }).on('error', (err: Error) => failRequest(err.message));
  });
});

process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled promise rejection');
});

app.listen({ port: 8081, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
