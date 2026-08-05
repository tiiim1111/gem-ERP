import { z } from "zod";

/**
 * Environment validation for the worker process. Runs at import time so the
 * process fails fast — before any Redis connection or queue is created — when
 * a variable is missing or malformed.
 *
 * In development the `dev` script loads the repo-root `.env` via Node's
 * `--env-file-if-exists`; in production the environment must be provided by
 * the runtime (compose file, systemd unit, orchestrator, ...).
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  REDIS_URL: z
    .string({ required_error: "REDIS_URL is required (see .env.example at the repo root)" })
    .url()
    .refine(
      (value) => value.startsWith("redis://") || value.startsWith("rediss://"),
      { message: "REDIS_URL must be a redis:// or rediss:// URL" },
    ),
  /**
   * Phase 5: the maintenance-reminders processor generates work orders from
   * due plans and needs database access. Optional so a worker deployed
   * without it keeps draining its other queues — the maintenance job then
   * logs a warning and skips instead of crashing the process.
   */
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "DATABASE_URL must be a postgresql:// URL",
    })
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The pino logger depends on a validated env, so plain stderr is used here.
  console.error("[gemerp-worker] Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

export const env: Env = parsed.data;
