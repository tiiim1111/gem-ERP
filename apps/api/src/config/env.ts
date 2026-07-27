/**
 * Zod-validated environment configuration. Fails fast: any missing or
 * malformed variable stops the process before Nest bootstraps.
 *
 * In non-production the root monorepo .env (and an optional apps/api/.env)
 * are loaded first — without adding a dotenv dependency — so `pnpm dev` works
 * out of the box. Existing process env vars always win over file values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgresql:// URL'),

  REDIS_URL: z
    .string()
    .regex(/^redis(s)?:\/\//, 'REDIS_URL must be a redis:// URL')
    .default('redis://localhost:6379'),

  SESSION_COOKIE_NAME: z.string().min(1).default('gemerp_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  SESSION_COOKIE_SECURE: booleanString.default('false'),

  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).default('gemerp'),
  S3_SECRET_KEY: z.string().min(1).default('gemerp_dev_password'),
  S3_BUCKET: z.string().min(1).default('gemerp-attachments'),
  S3_FORCE_PATH_STYLE: booleanString.default('true'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Minimal .env parser (KEY=VALUE lines, # comments, optional quotes). */
function loadDotenvFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '' && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

let cached: Env | undefined;

/**
 * Parse and cache the environment. Exits the process with a readable message
 * when validation fails (fail fast — never boot half-configured).
 */
export function loadEnv(): Env {
  if (cached) {
    return cached;
  }
  if (process.env.NODE_ENV !== 'production') {
    // App-local .env wins over the repo root .env (both optional).
    loadDotenvFile(resolve(__dirname, '../../.env'));
    loadDotenvFile(resolve(__dirname, '../../../../.env'));
  }
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    console.error(
      `[gemerp-api] Invalid environment configuration:\n${lines.join('\n')}\n` +
        'See .env.example at the repository root for every supported variable.',
    );
    process.exit(1);
  }
  cached = result.data;
  return cached;
}
