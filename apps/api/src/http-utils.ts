/**
 * Shared HTTP/serialisation helpers used across API routes.
 */
import { config } from './config.js';
import { fromJsonField } from './db-compat.js';

/** Extract a Bearer token from an Authorization header. */
export function bearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  return authorizationHeader.slice(7).trim() || null;
}

export interface PublicOrigin {
  host: string;
  scheme: 'http' | 'https';
  origin: string;
}

/** Resolve the externally reachable origin, keeping IP/localhost deployments on http. */
export function resolvePublicOrigin(requestHost?: string): PublicOrigin {
  const host = config.POCKETCLOUD_DOMAIN !== 'localhost' ? config.POCKETCLOUD_DOMAIN : (requestHost || 'localhost');
  const hostPart = host.split(':')[0] || '';
  const isIPOrLocalhost = hostPart === 'localhost' || /^[0-9.]+$/.test(hostPart);
  const scheme = isIPOrLocalhost ? 'http' : 'https';
  return { host, scheme, origin: `${scheme}://${host}` };
}

/** Build the one-liner agent installation command handed to operators. */
export function buildAgentInstallCommand(requestHost: string | undefined, bootstrapToken: string): string {
  const { origin } = resolvePublicOrigin(requestHost);
  return `curl -fsSL ${origin}/install-agent.sh | bash -s -- --token ${bootstrapToken} --control-plane ${origin}`;
}

/** Normalise a task record so its payload is a plain object on both SQLite and PostgreSQL. */
export function serializeTask<T extends { payload: unknown }>(task: T): T & { payload: unknown } {
  return { ...task, payload: fromJsonField(task.payload) };
}

/** Convert a metric row's BigInt uptime into a JSON-serialisable number. */
export function serializeMetric<T extends { uptime: unknown }>(metric: T): T & { uptime: number | null } {
  return { ...metric, uptime: metric.uptime === null || metric.uptime === undefined ? null : Number(metric.uptime) };
}
