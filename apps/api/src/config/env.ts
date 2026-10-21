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

/*
 * docker-compose substitutes an unset `${VAR:-}` as `VAR=""` rather than
 * omitting it, so a plain `.optional()` on a non-empty schema would reject the
 * default production config — and loadEnv exits the process on a validation
 * failure, so the API simply would not boot. These two helpers treat an empty
 * string as absent.
 *
 * The fallback has to live INSIDE the preprocess: an outer `.default()` only
 * fires for an undefined *input*, and the input here is the empty string.
 */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

function optionalEnv<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(emptyToUndefined, schema.optional());
}

function envWithDefault<T extends z.ZodTypeAny>(schema: T, fallback: z.input<T>) {
  return z.preprocess(emptyToUndefined, schema.default(fallback as never));
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /**
   * One or more allowed web origins, comma-separated. The FIRST entry is the
   * primary origin used for links the API generates (e.g. QR scan URLs).
   * Example: "http://192.168.0.109:3000,http://localhost:3000"
   */
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(z.string().url()).min(1)),

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

  /**
   * Object storage toggle. Attachments land in Phase 3.5 — deployments
   * without a MinIO/S3 service set this to false so readiness skips it.
   */
  S3_ENABLED: booleanString.default('true'),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).default('gemerp'),
  S3_SECRET_KEY: z.string().min(1).default('gemerp_dev_password'),
  S3_BUCKET: z.string().min(1).default('gemerp-attachments'),
  S3_FORCE_PATH_STYLE: booleanString.default('true'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .optional(),

  /*
   * HRIS employee feed (docs/hris-employee-api-phase2-decisions.md).
   *
   * Defaults off: the integration must be deployed, dry-run and reviewed
   * before it is allowed to write employees. Nothing here is required, so an
   * existing deployment keeps booting untouched.
   */
  GEMENI_HRIS_SYNC_ENABLED: booleanString.default('false'),
  GEMENI_HRIS_BASE_URL: optionalEnv(z.string().url()),
  GEMENI_HRIS_EMPLOYEE_PATH: envWithDefault(
    z.string().min(1),
    '/api/v1/integrations/gemeni/employees',
  ),
  /** Asserted against meta.companyCode on every page before reconciling. */
  GEMENI_HRIS_EXPECTED_COMPANY_CODE: envWithDefault(z.string().min(1), 'GEM'),
  /** Bearer token. Never logged, never returned by an endpoint. */
  GEMENI_HRIS_TOKEN: optionalEnv(z.string().min(1)),
  /**
   * Branch code every newly imported employee is filed under. The HRIS has no
   * branch concept and GEM-ENI requires one, so this is explicit rather than
   * guessed — and it is never reapplied to an employee that already exists.
   */
  GEMENI_HRIS_DEFAULT_BRANCH_CODE: optionalEnv(z.string().min(1)),
  /** Nightly schedule for the worker's repeatable job. */
  GEMENI_HRIS_SYNC_CRON: envWithDefault(z.string().min(1), '0 2 * * *'),
  GEMENI_HRIS_SYNC_TIMEZONE: envWithDefault(z.string().min(1), 'Asia/Manila'),
  GEMENI_HRIS_PAGE_SIZE: envWithDefault(z.coerce.number().int().min(1).max(500), 200),
  /** Per-request network timeout, milliseconds. */
  GEMENI_HRIS_TIMEOUT_MS: envWithDefault(
    z.coerce.number().int().min(1000).max(120000),
    15000,
  ),
  /** How often the API claims queued sync runs, milliseconds. */
  GEMENI_HRIS_POLL_MS: envWithDefault(
    z.coerce.number().int().min(5000).max(600000),
    30000,
  ),
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
