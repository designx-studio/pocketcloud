import { z } from 'zod';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
if (process.env.NODE_ENV !== 'production') loadEnv({ path: resolve(__dirname, '../../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  JWT_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(16),
  CORS_ORIGIN: z.string().default('*'),
  POCKETCLOUD_DOMAIN: z.string().min(1).default('localhost')
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'ENCRYPTION_KEY'] as const) {
      if (value[key].startsWith('dev-') || value[key].includes('CHANGE_ME')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} must be rotated before production` });
      }
    }
    if (value.CORS_ORIGIN === '*') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGIN'], message: 'CORS_ORIGIN must be explicit in production' });
    }
  }
});

export const config = schema.parse(process.env);
