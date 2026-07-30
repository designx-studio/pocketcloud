import { z } from 'zod';

// Load .env from repo root in development
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// In development (tsx), load from repo root. In production (dist/), load from process env.
if (process.env.NODE_ENV !== 'production') {
  const envPath = resolve(__dirname, '../../../.env');
  loadEnv({ path: envPath });
}

const schema = z.object({
  NODE_ENV:              z.enum(['development', 'test', 'production']).default('development'),
  PORT:                  z.coerce.number().default(8080),
  DATABASE_URL:          z.string().default('file:./dev.db'),
  JWT_SECRET:            z.string().default('dev-jwt-secret-change-this-in-production-min-32-chars'),
  REFRESH_TOKEN_SECRET:  z.string().default('dev-refresh-secret-change-this-in-production-min-32-chars'),
  ENCRYPTION_KEY:        z.string().default('dev-encryption-key-32bytes-change'),
  CORS_ORIGIN:           z.string().default('*'),
  POCKETCLOUD_DOMAIN:    z.string().default('localhost')
});

export const config = schema.parse(process.env);
