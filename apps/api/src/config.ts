import { z } from 'zod';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Canonical production env path used by the installer and Docker stack. */
const CANONICAL_ENV_PATH = '/opt/pocketcloud/.env';

function loadEnvironmentFiles() {
  // Prefer process env (Docker/K8s). Fall back to project .env in development,
  // and the canonical install path when present.
  if (process.env.NODE_ENV === 'production') {
    if (existsSync(CANONICAL_ENV_PATH)) {
      loadEnv({ path: CANONICAL_ENV_PATH, override: false });
    }
    return;
  }

  const projectEnv = resolve(__dirname, '../../../.env');
  if (existsSync(projectEnv)) {
    loadEnv({ path: projectEnv });
  }
}

loadEnvironmentFiles();

function printConfigFailure(lines: string[]): never {
  const message = [
    '',
    'PocketCloud failed to start.',
    '',
    'Configuration validation failed.',
    '',
    ...lines,
    '',
    'Review:',
    '',
    CANONICAL_ENV_PATH,
    '(or the environment variables injected into the process)',
    ''
  ].join('\n');
  // Exit cleanly so operators see the diagnostic, not only a ZodError stack.
  console.error(message);
  process.exit(1);
}

// Explicit pre-checks so operators never only see a raw ZodError stack.
if (process.env.NODE_ENV === 'production' && process.env.CORS_ORIGIN === '*') {
  printConfigFailure([
    'CORS_ORIGIN cannot be \'*\' in production.',
    '',
    'Wildcard CORS is allowed only when NODE_ENV=development.',
    '',
    'Example:',
    'CORS_ORIGIN=https://cloud.example.com',
    '',
    'Also set:',
    'APP_URL=https://cloud.example.com',
    'API_URL=https://cloud.example.com/api',
    'WS_URL=wss://cloud.example.com/ws'
  ]);
}

if (process.env.NODE_ENV === 'production') {
  const cors = process.env.CORS_ORIGIN ?? '';
  // Allow http:// for IP addresses in production, but require https:// for domains
  const corsHost = cors.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(corsHost);
  
  if (cors.startsWith('http://') && !isIpAddress) {
    printConfigFailure([
      'CORS_ORIGIN must use https:// in production for domains.',
      '',
      `Received: ${cors}`,
      '',
      'Example:',
      'CORS_ORIGIN=https://cloud.example.com'
    ]);
  }
  if (cors && cors !== '*' && !cors.startsWith('http://') && !cors.startsWith('https://')) {
    printConfigFailure([
      'CORS_ORIGIN must be an absolute http:// or https:// origin in production.',
      '',
      `Received: ${cors}`,
      '',
      'Example:',
      'CORS_ORIGIN=https://cloud.example.com'
    ]);
  }
  if (/localhost|127\.0\.0\.1/i.test(cors)) {
    printConfigFailure([
      'CORS_ORIGIN cannot target localhost in production.',
      '',
      `Received: ${cors}`,
      '',
      'Example:',
      'CORS_ORIGIN=https://cloud.example.com'
    ]);
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  JWT_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(16),
  CORS_ORIGIN: z.string().default('*'),
  ENABLE_API_DOCS: z.enum(['true', 'false']).optional(),
  ENABLE_DEMO_MODE: z.enum(['true', 'false']).optional(),
  APP_URL: z.string().optional(),
  API_URL: z.string().optional(),
  WS_URL: z.string().optional(),
  POCKETCLOUD_DOMAIN: z.string().min(1).default('localhost')
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') {
    // Development / test: wildcard CORS is allowed.
    return;
  }

  for (const key of ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'ENCRYPTION_KEY'] as const) {
    if (value[key].startsWith('dev-') || value[key].includes('CHANGE_ME')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be rotated before production (do not use dev- or CHANGE_ME placeholders)`
      });
    }
  }

  if (value.CORS_ORIGIN === '*') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGIN'],
      message: "CORS_ORIGIN cannot be '*' in production. Example: CORS_ORIGIN=https://cloud.example.com"
    });
  } else {
    const corsHost = value.CORS_ORIGIN.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(corsHost);
    
    if (!value.CORS_ORIGIN.startsWith('http://') && !value.CORS_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN must be an http:// or https:// origin in production'
      });
    } else if (value.CORS_ORIGIN.startsWith('http://') && !isIpAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN must use https:// for domains in production (http:// allowed for IP addresses)'
      });
    }
  }

  if (value.APP_URL) {
    const appHost = value.APP_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(appHost);
    
    if (!value.APP_URL.startsWith('http://') && !value.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'APP_URL must be an http:// or https:// URL in production'
      });
    } else if (value.APP_URL.startsWith('http://') && !isIpAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'APP_URL must use https:// for domains in production (http:// allowed for IP addresses)'
      });
    }
  }
});

function parseConfig() {
  const result = schema.safeParse(process.env);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : 'config';
    return `• ${path}: ${issue.message}`;
  });

  printConfigFailure([
    'The following environment variables are invalid:',
    '',
    ...issues,
    '',
    'Production example:',
    'NODE_ENV=production',
    'APP_URL=https://cloud.example.com',
    'API_URL=https://cloud.example.com/api',
    'WS_URL=wss://cloud.example.com/ws',
    'CORS_ORIGIN=https://cloud.example.com',
    '',
    'Development example:',
    'NODE_ENV=development',
    'CORS_ORIGIN=*'
  ]);
}

export const config = parseConfig();
