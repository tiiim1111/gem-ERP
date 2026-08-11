/**
 * Phase 7 report-exports processor (api-outline §8).
 *
 * The API enqueues export_jobs rows with the authorization evaluated at
 * enqueue time (report.export + underlying report permission + branch scope;
 * include_cost and branch_ids are snapshotted onto the row). This processor
 * drains QUEUED rows: it claims each atomically (updateMany QUEUED →
 * PROCESSING — safe across worker replicas without advisory locks), runs the
 * SAME @gemerp/reports registry definition the API endpoints use, renders
 * csv/xlsx/pdf, stores the file in object storage, notifies the requester
 * (EXPORT_READY / EXPORT_FAILED), and audit-logs the outcome.
 *
 * Failures — including S3_ENABLED=false — mark the job FAILED with a clear
 * error and never crash the worker.
 */
import { ExportJobStatus, Prisma, PrismaClient } from "@prisma/client";
import {
  NOTIFICATION_LINKS,
  NOTIFICATION_TYPES,
  notificationDedupeKey,
} from "@gemerp/shared";
import type { ExportFormat, ReportFilters } from "@gemerp/reports";
import {
  EXPORT_CONTENT_TYPES,
  exportFileName,
  getReportDefinition,
  isExportFormat,
  renderExport,
  runReportFull,
  validateReportFilters,
} from "@gemerp/reports";

import type { logger as rootLogger } from "../logger";
import { ExportStorageError, putExportObject } from "../storage";
import { writeNotificationOnce } from "./notification-helpers";

type Logger = typeof rootLogger;

export interface ExportProcessSummary {
  processed: number;
  completed: number;
  failed: number;
}

/** How many jobs one run will drain at most (the next run picks up the rest). */
const MAX_JOBS_PER_RUN = 20;

type ClaimedJob = Prisma.ExportJobGetPayload<{
  select: {
    id: true;
    reportKey: true;
    format: true;
    filters: true;
    includeCost: true;
    branchIds: true;
    requestedById: true;
  };
}>;

export async function processQueuedExports(
  prisma: PrismaClient,
  log: Logger,
): Promise<ExportProcessSummary> {
  const summary: ExportProcessSummary = { processed: 0, completed: 0, failed: 0 };

  for (let i = 0; i < MAX_JOBS_PER_RUN; i += 1) {
    const candidate = await prisma.exportJob.findFirst({
      where: { status: ExportJobStatus.QUEUED },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) {
      break;
    }
    // Atomic claim: exactly one worker replica flips QUEUED → PROCESSING.
    const claimed = await prisma.exportJob.updateMany({
      where: { id: candidate.id, status: ExportJobStatus.QUEUED },
      data: { status: ExportJobStatus.PROCESSING, startedAt: new Date() },
    });
    if (claimed.count !== 1) {
      continue; // another replica won the claim — move on
    }
    const job = await prisma.exportJob.findUniqueOrThrow({
      where: { id: candidate.id },
      select: {
        id: true,
        reportKey: true,
        format: true,
        filters: true,
        includeCost: true,
        branchIds: true,
        requestedById: true,
      },
    });
    summary.processed += 1;
    try {
      const result = await processOne(prisma, job);
      summary.completed += 1;
      log.info(
        { jobId: job.id, reportKey: job.reportKey, format: job.format, ...result },
        "export job completed",
      );
    } catch (error) {
      summary.failed += 1;
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      log.error(
        { jobId: job.id, reportKey: job.reportKey, err: error },
        "export job failed",
      );
      await failJob(prisma, job, message).catch((failError) => {
        log.error(
          { jobId: job.id, err: failError },
          "could not record the export failure",
        );
      });
    }
  }
  return summary;
}

async function processOne(
  prisma: PrismaClient,
  job: ClaimedJob,
): Promise<{ rowCount: number; sizeBytes: number; truncated: boolean }> {
  const definition = getReportDefinition(job.reportKey);
  if (!definition) {
    throw new Error(`Unknown report key "${job.reportKey}".`);
  }
  if (!isExportFormat(job.format)) {
    throw new Error(`Unsupported export format "${job.format}".`);
  }
  const format: ExportFormat = job.format;
  const filters = (job.filters ?? {}) as ReportFilters;
  const filterErrors = validateReportFilters(definition, filters);
  if (filterErrors.length > 0) {
    throw new Error(
      `Invalid filters: ${filterErrors
        .map((error) => `${error.field} — ${error.message}`)
        .join('; ')}`,
    );
  }
  // Branch scope snapshotted at enqueue: null = unrestricted (super admin).
  const branchIds =
    job.branchIds === null ? null : (job.branchIds as string[]);

  const { rows, truncated } = await runReportFull(definition, prisma, {
    branchIds,
    filters,
    includeCost: job.includeCost,
  });

  const buffer = await renderExport({
    definition,
    rows,
    includeCost: job.includeCost,
    format,
    filterSummary: summarizeFilters(filters),
    truncated,
  });

  const fileName = exportFileName(definition.key, format);
  const storageKey = `exports/${job.id}/${fileName}`;
  const contentType = EXPORT_CONTENT_TYPES[format];
  await putExportObject(storageKey, buffer, contentType);

  await prisma.exportJob.update({
    where: { id: job.id },
    data: {
      status: ExportJobStatus.COMPLETED,
      fileName,
      storageKey,
      contentType,
      sizeBytes: buffer.length,
      rowCount: rows.length,
      truncated,
      error: null,
      completedAt: new Date(),
    },
  });

  await writeNotificationOnce(prisma, {
    recipientId: job.requestedById,
    type: NOTIFICATION_TYPES.exportReady,
    title: "Export ready",
    message: `Your ${definition.title} export (${format.toUpperCase()}, ${rows.length.toLocaleString("en-US")} rows) is ready to download.`,
    resourceType: "export_job",
    resourceId: job.id,
    dedupeKey: notificationDedupeKey(
      NOTIFICATION_TYPES.exportReady,
      "export_job",
      job.id,
    ),
    link: NOTIFICATION_LINKS.exports(),
  });

  await auditExport(prisma, job, "report.export_completed", {
    reportKey: job.reportKey,
    format,
    rowCount: rows.length,
    sizeBytes: buffer.length,
    truncated,
  });

  return { rowCount: rows.length, sizeBytes: buffer.length, truncated };
}

async function failJob(
  prisma: PrismaClient,
  job: ClaimedJob,
  message: string,
): Promise<void> {
  await prisma.exportJob.update({
    where: { id: job.id },
    data: {
      status: ExportJobStatus.FAILED,
      error: message,
      completedAt: new Date(),
    },
  });
  await writeNotificationOnce(prisma, {
    recipientId: job.requestedById,
    type: NOTIFICATION_TYPES.exportFailed,
    title: "Export failed",
    message: `Your ${job.reportKey} export (${job.format}) failed: ${message}`,
    resourceType: "export_job",
    resourceId: job.id,
    dedupeKey: notificationDedupeKey(
      NOTIFICATION_TYPES.exportFailed,
      "export_job",
      job.id,
    ),
    link: NOTIFICATION_LINKS.exports(),
  });
  await auditExport(prisma, job, "report.export_failed", {
    reportKey: job.reportKey,
    format: job.format,
    error: message,
  });
}

/** Append-only audit entry for the export outcome (spec §22: exports are sensitive). */
async function auditExport(
  prisma: PrismaClient,
  job: ClaimedJob,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: job.requestedById,
      action,
      resourceType: "export_job",
      resourceId: job.id,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

function summarizeFilters(filters: ReportFilters): string | undefined {
  const entries = Object.entries(filters).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  if (entries.length === 0) {
    return undefined;
  }
  return `Filters: ${entries.map(([key, value]) => `${key}=${value}`).join(", ")}`;
}

// ExportStorageError is thrown by storage and handled like any failure above;
// re-exported so main.ts can special-case logging if ever needed.
export { ExportStorageError };
