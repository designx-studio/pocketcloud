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
  return `https://github.com/${GITHUB_REPO}/releases/download/v${AGENT_VERSION}/${SUPPORTED_PLATFORMS[platform]}`;
}

app.get('/api/v1/agent/releases', async (_req, reply) => {
  const releases = Object.entries(SUPPORTED_PLATFORMS).map(([platform, filename]) => {
    const filePath = safeReleasePath(filename);
    const available = Boolean(filePath && existsSync(filePath));
    return { platform, version: AGENT_VERSION, filename, available, sizeBytes: available ? statSync(filePath!).size : null, githubUrl: getGitHubReleaseUrl(platform) };
  });
  return reply.send({ version: AGENT_VERSION, releases });
});

app.get<{ Params: { platform: string } }>('/api/v1/agent/releases/:platform', async (req, reply) => {
  const filename = SUPPORTED_PLATFORMS[req.params.platform];
  if (!filename) return reply.code(400).send({ error: 'unsupported_platform', supported: Object.keys(SUPPORTED_PLATFORMS) });
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

  const githubUrl = getGitHubReleaseUrl(req.params.platform);
  app.log.info(`Local binary not found for ${req.params.platform}, fetching from GitHub: ${githubUrl}`);
  return new Promise<void>((resolveRequest) => {
    const request = (url: string, redirects = 0) => {
      if (redirects > 5) { if (!reply.sent) reply.code(502).send({ error: 'github_release_failed', message: 'Too many redirects' }); resolveRequest(); return; }
      https.get(url, { headers: { 'User-Agent': 'PocketCloud-Agent-Registry' } }, (githubRes) => {
        const location = githubRes.headers.location;
        if (githubRes.statusCode && githubRes.statusCode >= 300 && githubRes.statusCode < 400 && location) {
          githubRes.resume();
          request(new URL(location, url).toString(), redirects + 1);
          return;
        }
        if (githubRes.statusCode !== 200) { githubRes.resume(); if (!reply.sent) reply.code(502).send({ error: 'github_release_failed', message: `GitHub returned ${githubRes.statusCode}` }); resolveRequest(); return; }
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('X-Agent-Version', AGENT_VERSION);
        reply.header('X-Agent-Source', 'github');
        if (githubRes.headers['content-length']) reply.header('Content-Length', githubRes.headers['content-length']);
        githubRes.pipe(reply.raw);
        githubRes.on('end', resolveRequest);
        githubRes.on('error', (err) => { app.log.error(`GitHub proxy error: ${err.message}`); if (!reply.sent) reply.code(502).send({ error: 'github_release_failed', message: err.message }); resolveRequest(); });
      }).on('error', (err) => { app.log.error(`GitHub proxy error: ${err.message}`); if (!reply.sent) reply.code(502).send({ error: 'github_release_failed', message: err.message }); resolveRequest(); });
    };
    request(githubUrl);
  });
});

app.listen({ port: 8081, host: '0.0.0.0' }).catch((err) => { app.log.error(err); process.exit(1); });
