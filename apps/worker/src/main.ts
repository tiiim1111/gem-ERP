/**
 * GEM ERP background worker (apps/worker).
 *
 * Phase 1 scope: real BullMQ infrastructure only — validated env, shared Redis
 * connection, queue + worker registration with retry/backoff defaults, a
 * repeatable liveness heartbeat, and graceful shutdown. The business
 * processors are deliberate stubs (they log receipt and complete) so the
 * wiring is testable end to end today without pretending features exist; the
 * per-queue comments below say exactly which phase fills each one in.
 */
import { Queue, Worker, type Job, type JobsOptions, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";

import { env } from "./env";
import { generateWorkOrdersFromDuePlans } from "./jobs/maintenance-work-orders";
import { logger } from "./logger";
import {
  DEFAULT_JOB_OPTIONS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_JOB_OPTIONS,
  MAINTENANCE_GENERATION_INTERVAL_MS,
  QUEUE_NAMES,
} from "./queues";

// ---------------------------------------------------------------------------
// Redis connection
// ---------------------------------------------------------------------------
// One shared ioredis instance. BullMQ duplicates it internally whenever a
// blocking connection is required (one per Worker), so Queues and Workers can
// safely share it. `maxRetriesPerRequest: null` is mandatory for Workers.
const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

connection.on("ready", () => {
  logger.info("redis connection ready");
});
connection.on("error", (error) => {
  logger.error({ err: error }, "redis connection error");
});
connection.on("reconnecting", () => {
  logger.warn("redis reconnecting");
});

// ---------------------------------------------------------------------------
// Registration helpers
// ---------------------------------------------------------------------------
const queues: Queue[] = [];
const workers: Worker[] = [];

function registerQueue(name: string, jobOptions: JobsOptions = DEFAULT_JOB_OPTIONS): Queue {
  const queue = new Queue(name, { connection, defaultJobOptions: jobOptions });
  queue.on("error", (error) => {
    logger.error({ queue: name, err: error }, "queue error");
  });
  queues.push(queue);
  return queue;
}

function registerWorker(name: string, processor: Processor): Worker {
  const worker = new Worker(name, processor, { connection });
  worker.on("completed", (job) => {
    logger.debug({ queue: name, jobId: job.id, jobName: job.name }, "job completed");
  });
  worker.on("failed", (job, error) => {
    logger.error(
      { queue: name, jobId: job?.id, jobName: job?.name, attemptsMade: job?.attemptsMade, err: error },
      "job failed",
    );
  });
  worker.on("error", (error) => {
    logger.error({ queue: name, err: error }, "worker error");
  });
  workers.push(worker);
  return worker;
}

/** Shared stub behavior: acknowledge the job in the logs and complete. */
async function acknowledgeStub(job: Job, filledInBy: string): Promise<void> {
  logger.info(
    { queue: job.queueName, jobId: job.id, jobName: job.name, data: job.data },
    `job received — processor is a Phase 1 stub, real logic lands in ${filledInBy}`,
  );
}

// ---------------------------------------------------------------------------
// Queue + worker registration
// ---------------------------------------------------------------------------

// "maintenance-reminders" — Phase 5 (Maintenance): scans due maintenance
// plans and generates work orders (idempotent — exactly one open WO per due
// plan+asset; see jobs/maintenance-work-orders.ts). Reminder NOTIFICATION
// fan-out is deferred to Phase 6 (notifications module); reminder-window
// hits are logged in the meantime. Requires DATABASE_URL — without it the
// processor warns and skips instead of crashing the worker.
let prismaClient: PrismaClient | undefined;
function getPrisma(): PrismaClient | null {
  if (!env.DATABASE_URL) {
    return null;
  }
  prismaClient ??= new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });
  return prismaClient;
}

const maintenanceQueue = registerQueue(QUEUE_NAMES.MAINTENANCE_REMINDERS);
registerWorker(QUEUE_NAMES.MAINTENANCE_REMINDERS, async (job) => {
  if (job.name !== "generate-due-work-orders") {
    await acknowledgeStub(job, "Phase 6 (Notifications)");
    return;
  }
  const prisma = getPrisma();
  if (!prisma) {
    logger.warn(
      { queue: job.queueName, jobId: job.id },
      "DATABASE_URL is not configured — skipping maintenance work-order generation",
    );
    return;
  }
  const summary = await generateWorkOrdersFromDuePlans(prisma, logger);
  logger.info({ jobId: job.id, ...summary }, "maintenance work-order generation done");
});

// "notifications" — STUB until Phase 6 (Counts, approvals, and notifications):
// the real processor will deliver in-app notifications (low stock, warranty
// expiry, approval requests). Until then it only logs receipt and completes.
registerQueue(QUEUE_NAMES.NOTIFICATIONS);
registerWorker(QUEUE_NAMES.NOTIFICATIONS, (job) =>
  acknowledgeStub(job, "Phase 6 (Notifications)"),
);

// "report-exports" — STUB until Phase 7 (Analytics and reports): the real
// processor will run heavy CSV/XLSX/PDF exports, upload the result to object
// storage, and notify the requesting user. Until then it only logs receipt
// and completes.
registerQueue(QUEUE_NAMES.REPORT_EXPORTS);
registerWorker(QUEUE_NAMES.REPORT_EXPORTS, (job) =>
  acknowledgeStub(job, "Phase 7 (Reports)"),
);

// "worker-heartbeat" — fully implemented: a repeatable job (every 5 minutes)
// that logs worker liveness so operators can confirm the worker is alive and
// draining queues just by tailing the logs.
const heartbeatQueue = registerQueue(QUEUE_NAMES.HEARTBEAT, HEARTBEAT_JOB_OPTIONS);
registerWorker(QUEUE_NAMES.HEARTBEAT, async () => {
  logger.info(
    {
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: process.memoryUsage().rss,
      queues: queues.map((queue) => queue.name),
    },
    "worker heartbeat: alive",
  );
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
const SHUTDOWN_TIMEOUT_MS = 30_000;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    logger.warn({ signal }, "shutdown already in progress");
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  const forceExitTimer = setTimeout(() => {
    logger.fatal({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // Workers first: stop taking new jobs and wait for in-flight jobs to end.
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await Promise.allSettled(queues.map((queue) => queue.close()));
    if (prismaClient) {
      await prismaClient.$disconnect().catch(() => undefined);
    }
    await connection.quit().catch(() => {
      connection.disconnect();
    });
    clearTimeout(forceExitTimer);
    logger.info("shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.fatal({ err: error }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled promise rejection");
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception");
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Idempotent across restarts: upserting the scheduler never creates
  // duplicate repeatable jobs. The first heartbeat fires on startup, then
  // every HEARTBEAT_INTERVAL_MS.
  await heartbeatQueue.upsertJobScheduler(
    "worker-heartbeat-every-5m",
    { every: HEARTBEAT_INTERVAL_MS },
    { name: "heartbeat" },
  );

  // Phase 5: hourly due-plan scan. The processor is idempotent, so the
  // cadence only bounds detection latency — re-runs never duplicate WOs.
  await maintenanceQueue.upsertJobScheduler(
    "maintenance-generate-hourly",
    { every: MAINTENANCE_GENERATION_INTERVAL_MS },
    { name: "generate-due-work-orders" },
  );

  const redisTarget = new URL(env.REDIS_URL);
  logger.info(
    {
      nodeEnv: env.NODE_ENV,
      redis: `${redisTarget.protocol}//${redisTarget.host}`,
      queues: queues.map((queue) => queue.name),
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    },
    "worker started",
  );
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
