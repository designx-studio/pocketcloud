import { describe, it, expect, afterEach, vi } from 'vitest';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  JWT_SECRET: 'prod-jwt-secret-that-is-at-least-32-chars',
  REFRESH_TOKEN_SECRET: 'prod-refresh-secret-that-is-at-least-32-chars',
  ENCRYPTION_KEY: 'prod-encryption-key-32-chars-min',
  CORS_ORIGIN: 'https://cloud.example.com',
  APP_URL: 'https://cloud.example.com',
  DATABASE_URL: 'postgresql://pocketcloud:pocketcloud@localhost:5432/pocketcloud'
};

class ProcessExit extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of Object.keys(BASE_ENV)) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) vi.stubEnv(key, value);
  }
  const errors: string[] = [];
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
    errors.push(String(message));
  });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExit(code);
  }) as never);

  try {
    const { config } = await import('../apps/api/src/config.js');
    return { config, errors, exited: false };
  } catch (error) {
    if (error instanceof ProcessExit) return { config: undefined, errors, exited: true };
    throw error;
  } finally {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

describe('api configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('applies defaults in development', async () => {
    const { config, exited } = await loadConfig({ ...BASE_ENV, NODE_ENV: 'development', CORS_ORIGIN: '*', APP_URL: 'http://localhost:3000' });

    expect(exited).toBe(false);
    expect(config).toMatchObject({ NODE_ENV: 'development', PORT: 8080, CORS_ORIGIN: '*', POCKETCLOUD_DOMAIN: 'localhost' });
  });

  it('coerces PORT and keeps explicit values', async () => {
    const { config } = await loadConfig({ ...BASE_ENV, NODE_ENV: 'development', PORT: '9090', POCKETCLOUD_DOMAIN: 'cloud.example.com' });

    expect(config).toMatchObject({ PORT: 9090, POCKETCLOUD_DOMAIN: 'cloud.example.com' });
  });

  it('accepts a valid production configuration', async () => {
    const { config, exited } = await loadConfig(BASE_ENV);

    expect(exited).toBe(false);
    expect(config).toMatchObject({ NODE_ENV: 'production', CORS_ORIGIN: 'https://cloud.example.com' });
  });

  it('allows http origins for bare IP addresses in production', async () => {
    const { config, exited } = await loadConfig({ ...BASE_ENV, CORS_ORIGIN: 'http://203.0.113.10', APP_URL: 'http://203.0.113.10' });

    expect(exited).toBe(false);
    expect(config?.CORS_ORIGIN).toBe('http://203.0.113.10');
  });

  it.each([
    ['wildcard CORS', { CORS_ORIGIN: '*' }, "CORS_ORIGIN cannot be '*' in production"],
    ['http CORS for a domain', { CORS_ORIGIN: 'http://cloud.example.com' }, 'CORS_ORIGIN must use https:// in production for domains'],
    ['schemeless CORS', { CORS_ORIGIN: 'cloud.example.com' }, 'CORS_ORIGIN must be an absolute http:// or https:// origin'],
    ['localhost CORS', { CORS_ORIGIN: 'https://localhost:3000' }, 'CORS_ORIGIN cannot target localhost in production']
  ])('rejects %s in production', async (_name, overrides, expectedMessage) => {
    const { errors, exited } = await loadConfig({ ...BASE_ENV, ...overrides });

    expect(exited).toBe(true);
    expect(errors.join('\n')).toContain(expectedMessage);
  });

  it.each([
    ['dev- placeholder secrets', { JWT_SECRET: 'dev-jwt-secret-change-this-in-production-min-32' }, 'JWT_SECRET must be rotated before production'],
    ['CHANGE_ME placeholder secrets', { ENCRYPTION_KEY: 'CHANGE_ME-encryption-key-32-chars' }, 'ENCRYPTION_KEY must be rotated before production'],
    ['schemeless APP_URL', { APP_URL: 'cloud.example.com' }, 'APP_URL must be an http:// or https:// URL in production'],
    ['http APP_URL for a domain', { APP_URL: 'http://cloud.example.com' }, 'APP_URL must use https:// for domains in production']
  ])('reports %s as a validation issue', async (_name, overrides, expectedMessage) => {
    const { errors, exited } = await loadConfig({ ...BASE_ENV, ...overrides });

    expect(exited).toBe(true);
    expect(errors.join('\n')).toContain(expectedMessage);
  });

  it('reports missing and too-short secrets with the env path', async () => {
    const { errors, exited } = await loadConfig({ ...BASE_ENV, NODE_ENV: 'development', JWT_SECRET: undefined, ENCRYPTION_KEY: 'short' });

    expect(exited).toBe(true);
    const output = errors.join('\n');
    expect(output).toContain('JWT_SECRET');
    expect(output).toContain('ENCRYPTION_KEY');
    expect(output).toContain('/opt/pocketcloud/.env');
  });

  it('rejects an unknown NODE_ENV and an out-of-range PORT', async () => {
    const { errors, exited } = await loadConfig({ ...BASE_ENV, NODE_ENV: 'staging', PORT: '70000' });

    expect(exited).toBe(true);
    expect(errors.join('\n')).toContain('NODE_ENV');
    expect(errors.join('\n')).toContain('PORT');
  });
});
