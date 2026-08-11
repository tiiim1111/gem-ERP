import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { ExportJobStatus, Prisma } from '@prisma/client';
import type { Paginated } from '@gemerp/shared';
import type { ReportFilters } from '@gemerp/reports';
import { getReportDefinition, validateReportFilters } from '@gemerp/reports';
import { AttachmentStorageService } from '../attachments/attachment-storage.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { canRunReport, includeCostColumns } from '../reports/report-access';
import { CreateExportDto, QueryExportsDto } from './dto/export.dto';

/** One export job as the API serves it (statuses lowercase per contract §8). */
export interface ExportJobView {
  id: string;
  reportKey: string;
  format: string;
  filters: Record<string, string>;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  rowCount: number | null;
  truncated: boolean;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ExportDownload {
  stream: Readable;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
}

const JOB_SELECT = {
  id: true,
  reportKey: true,
  format: true,
  filters: true,
  status: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  rowCount: true,
  truncated: true,
  error: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} satisfies Prisma.ExportJobSelect;

type JobRow = Prisma.ExportJobGetPayload<{ select: typeof JOB_SELECT }>;

function toView(row: JobRow): ExportJobView {
  return {
    id: row.id,
    reportKey: row.reportKey,
    format: row.format,
    filters: (row.filters as Record<string, string> | null) ?? {},
    status: row.status.toLowerCase() as ExportJobView['status'],
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    rowCount: row.rowCount,
    truncated: row.truncated,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/**
 * Background report exports (api-outline §8). POST verifies report.export
 * (route guard) + the report's underlying permission + branch scope AT
 * ENQUEUE and snapshots the evaluated authorization (includeCost, branch
 * ids) onto the job row; the worker's report-exports queue does the heavy
 * rendering. Jobs are strictly owner-scoped — another user's job is a 404,
 * never a 403 (no existence leak).
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly storage: AttachmentStorageService,
  ) {}

  async create(
    user: AuthUser,
    dto: CreateExportDto,
    ctx: AuditContext,
  ): Promise<ExportJobView> {
    const definition = getReportDefinition(dto.reportKey);
    if (!definition) {
      throw AppException.validation([
        { field: 'reportKey', message: `unknown report "${dto.reportKey}"` },
      ]);
    }
    if (!canRunReport(user, definition)) {
      throw AppException.forbidden(
        'You do not have permission to export this report.',
      );
    }
    const rawFilters = dto.filters ?? {};
    for (const [key, value] of Object.entries(rawFilters)) {
      if (typeof value !== 'string') {
        throw AppException.validation([
          { field: `filters.${key}`, message: 'filter values must be strings' },
        ]);
      }
    }
    const filters = rawFilters as ReportFilters;
    const errors = validateReportFilters(definition, filters);
    if (errors.length > 0) {
      throw AppException.validation(
        errors.map((error) => ({
          field: `filters.${error.field}`,
          message: error.message,
        })),
      );
    }
    if (filters.branchId) {
      this.branchScope.assertBranchAccess(user, filters.branchId);
    }

    const branchIds = this.branchScope.branchIdsFor(user);
    const job = await this.prisma.exportJob.create({
      data: {
        reportKey: definition.key,
        format: dto.format,
        filters: filters as Prisma.InputJsonValue,
        includeCost: includeCostColumns(user, definition),
        branchIds:
          branchIds === null ? Prisma.DbNull : (branchIds as Prisma.InputJsonValue),
        requestedById: user.id,
      },
      select: JOB_SELECT,
    });

    await this.audit.log({
      ...ctx,
      action: 'report.export_queued',
      resourceType: 'export_job',
      resourceId: job.id,
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      newValues: { reportKey: definition.key, format: dto.format, filters },
      metadata: { includeCost: includeCostColumns(user, definition) },
    });
    return toView(job);
  }

  async list(
    user: AuthUser,
    query: QueryExportsDto,
  ): Promise<Paginated<ExportJobView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const where: Prisma.ExportJobWhereInput = {
      requestedById: user.id,
      ...(query.status
        ? { status: query.status.toUpperCase() as ExportJobStatus }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.exportJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: JOB_SELECT,
      }),
      this.prisma.exportJob.count({ where }),
    ]);
    return paginated(rows.map(toView), page, pageSize, total);
  }

  async getById(user: AuthUser, id: string): Promise<ExportJobView> {
    const row = await this.ownJob(user, id, JOB_SELECT);
    return toView(row);
  }

  async download(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<ExportDownload> {
    const row = await this.ownJob(user, id, {
      ...JOB_SELECT,
      storageKey: true,
    });
    if (row.status !== ExportJobStatus.COMPLETED || !row.storageKey) {
      throw AppException.invalidStateTransition(
        row.status === ExportJobStatus.FAILED
          ? `This export failed: ${row.error ?? 'unknown error'}`
          : 'This export is not finished yet.',
      );
    }
    const { body } = await this.storage.getStream(row.storageKey);
    await this.audit.log({
      ...ctx,
      action: 'report.export_downloaded',
      resourceType: 'export_job',
      resourceId: row.id,
      metadata: { reportKey: row.reportKey, format: row.format },
    });
    return {
      stream: body,
      fileName: row.fileName ?? `${row.reportKey}.${row.format}`,
      contentType: row.contentType ?? 'application/octet-stream',
      sizeBytes: row.sizeBytes,
    };
  }

  /** Fetch a job the caller owns; anything else is a 404 (owner-only scope). */
  private async ownJob<S extends Prisma.ExportJobSelect>(
    user: AuthUser,
    id: string,
    select: S,
  ): Promise<Prisma.ExportJobGetPayload<{ select: S }>> {
    const row = await this.prisma.exportJob.findFirst({
      where: { id, requestedById: user.id },
      select,
    });
    if (!row) {
      throw AppException.notFound('Export job not found.');
    }
    return row as Prisma.ExportJobGetPayload<{ select: S }>;
  }
}
