import type { JobsOptions } from "bullmq";

/**
 * Queue names owned by this worker.
 *
 * apps/api becomes the producer for the first three queues in Phases 5-7;
 * once the first producer lands these names should move to @gemerp/shared so
 * both processes import a single constant instead of repeating strings.
 */
export const QUEUE_NAMES = {
  /** Consumed here; produced by apps/api starting in Phase 5 (Maintenance). */
  MAINTENANCE_REMINDERS: "maintenance-reminders",
  /** Consumed here; produced by apps/api starting in Phase 6 (Notifications). */
  NOTIFICATIONS: "notifications",
  /** Consumed here; produced by apps/api starting in Phase 7 (Reports). */
  REPORT_EXPORTS: "report-exports",
  /** Internal to the worker: repeatable liveness heartbeat. */
  HEARTBEAT: "worker-heartbeat",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Heartbeat cadence: prove worker liveness in the logs every 5 minutes. */
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Due-plan scan cadence (Phase 5). Hourly is plenty: plan dueness has day
 * granularity, and the generation job is idempotent so the interval only
 * bounds detection latency.
 */
export const MAINTENANCE_GENERATION_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Alert-detector cadence (Phase 6). Every 15 minutes: detectors are
 * idempotent through the notification dedup keys, so the interval only
 * bounds how fast a new condition (low stock, expiring lot, overdue WO,
 * unreceived transfer, ...) surfaces as an in-app notification.
 */
export const NOTIFICATION_DETECTOR_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Export-drain cadence (Phase 7). Every 30 seconds the repeatable
 * "process-queued-exports" job claims QUEUED export_jobs rows (atomic
 * QUEUED→PROCESSING updateMany — replica-safe without advisory locks) and
 * renders them. The interval only bounds pickup latency; re-runs never
 * double-process a job.
 */
export const EXPORT_POLL_INTERVAL_MS = 30 * 1000;

/**
 * Retry/backoff defaults applied to every business queue. Individual jobs can
 * override these when enqueued. Failed jobs are retried 3 times with
 * exponential backoff (5s, 10s, 20s); completed jobs are kept for a day (max
 * 1000) and failures for a week so they can be inspected.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/**
 * The heartbeat is observability, not business work: never retry it, keep only
 * a small trail of past runs.
 */
export const HEARTBEAT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { count: 24 },
  removeOnFail: { count: 24 },
};
