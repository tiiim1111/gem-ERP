/*
 * Read side of the HRIS integration, plus mapping edits.
 *
 * Nothing here ever returns the bearer token or the fully-qualified producer
 * URL's credentials; `baseUrl` is shown because an operator needs to know
 * which host is being read, and it carries no secret.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { HrisSyncStatus, HrisSyncTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthUser } from '../../common/types/auth-request';
import { HrisClientService } from './hris-client.service';
import { HrisSyncService } from './hris-sync.service';
import { HrisPayloadError } from './hris-payload';
import { HrisTransportError } from './hris-client.service';
import type {
  QueryRunsDto,
  QueueRunDto,
  UpdateDepartmentMapDto,
  UpdatePositionMapDto,
} from './dto/hris.dto';

export interface HrisStatusView {
  enabled: boolean;
  configured: boolean;
  baseUrl: string | null;
  employeePath: string;
  expectedCompanyCode: string;
  defaultBranch: { code: string; name: string; id: string } | null;
  /** Set when a code is configured but does not resolve to an active branch. */
  defaultBranchProblem: string | null;
  /**
   * Active branches, so the admin page can show which code to configure. The
   * setting is an env var and needs the exact code, and hunting for it in the
   * database is a poor first experience at precisely the blocking step.
   */
  availableBranches: Array<{ id: string; code: string; name: string }>;
  cron: string;
  timezone: string;
  lastRun: HrisRunView | null;
  lastSuccessfulAt: string | null;
  linkedEmployees: number;
  unlinkedEmployees: number;
  pendingRun: { id: string; status: HrisSyncStatus; dryRun: boolean } | null;
  unmappedCodes: number;
}

export interface HrisRunView {
  id: string;
  trigger: HrisSyncTrigger;
  dryRun: boolean;
  status: HrisSyncStatus;
  startedAt: string | null;
  finishedAt: string | null;
  companyCode: string | null;
  producerTotal: number | null;
  pagesFetched: number | null;
  counts: {
    created: number;
    linked: number;
    updated: number;
    unchanged: number;
    skipped: number;
    failed: number;
  };
  error: string | null;
  createdAt: string;
  issues?: Array<{
    id: string;
    severity: string;
    code: string;
    employeeNumber: string | null;
    employeeId: string | null;
    message: string;
  }>;
}

export interface HrisMappingsView {
  departments: Array<{
    id: string;
    hrisCode: string;
    target: { id: string; code: string; name: string } | null;
    autoSuggested: boolean;
  }>;
  positions: Array<{
    id: string;
    hrisCode: string;
    target: { id: string; code: string; name: string } | null;
    autoSuggested: boolean;
  }>;
  availableDepartments: Array<{ id: string; code: string; name: string }>;
  availablePositions: Array<{ id: string; code: string; name: string }>;
}

@Injectable()
export class HrisAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly client: HrisClientService,
    private readonly sync: HrisSyncService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The one fact the ordinary employee screens need. Kept free of connection
   * detail so it can be served under employee.view.
   */
  employeeSource(): { hrisManaged: boolean } {
    return { hrisManaged: this.config.hris.enabled };
  }

  async status(): Promise<HrisStatusView> {
    const hris = this.config.hris;
    const [lastRun, lastSuccess, linked, unlinked, pending, unmappedDepartments, unmappedPositions] =
      await Promise.all([
        this.prisma.hrisSyncRun.findFirst({
          orderBy: { createdAt: 'desc' },
          include: { issues: true },
        }),
        this.prisma.hrisSyncRun.findFirst({
          where: {
            dryRun: false,
            status: { in: [HrisSyncStatus.SUCCEEDED, HrisSyncStatus.REVIEW_REQUIRED] },
          },
          orderBy: { finishedAt: 'desc' },
          select: { finishedAt: true },
        }),
        this.prisma.employee.count({ where: { hrisId: { not: null }, archivedAt: null } }),
        this.prisma.employee.count({ where: { hrisId: null, archivedAt: null } }),
        this.prisma.hrisSyncRun.findFirst({
          where: { status: { in: [HrisSyncStatus.QUEUED, HrisSyncStatus.RUNNING] } },
          select: { id: true, status: true, dryRun: true },
        }),
        this.prisma.hrisDepartmentMap.count({ where: { departmentId: null } }),
        this.prisma.hrisPositionMap.count({ where: { positionId: null } }),
      ]);

    const availableBranches = await this.prisma.branch.findMany({
      where: { isActive: true, archivedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });

    let defaultBranch: HrisStatusView['defaultBranch'] = null;
    let defaultBranchProblem: string | null = null;
    if (hris.defaultBranchCode) {
      const branch = await this.prisma.branch.findFirst({
        where: { code: hris.defaultBranchCode },
        select: { id: true, code: true, name: true, isActive: true, archivedAt: true },
      });
      if (!branch) {
        defaultBranchProblem = `No branch has the code "${hris.defaultBranchCode}".`;
      } else if (!branch.isActive || branch.archivedAt) {
        defaultBranchProblem = `Branch "${branch.code}" is not active.`;
      } else {
        defaultBranch = { id: branch.id, code: branch.code, name: branch.name };
      }
    } else {
      defaultBranchProblem =
        'GEMENI_HRIS_DEFAULT_BRANCH_CODE is not set. New employees cannot be created without it.';
    }

    return {
      enabled: hris.enabled,
      configured: this.config.hrisConfigured,
      baseUrl: hris.baseUrl ?? null,
      employeePath: hris.employeePath,
      expectedCompanyCode: hris.expectedCompanyCode,
      defaultBranch,
      defaultBranchProblem,
      availableBranches,
      cron: hris.cron,
      timezone: hris.timezone,
      lastRun: lastRun ? this.toRunView(lastRun, true) : null,
      lastSuccessfulAt: lastSuccess?.finishedAt?.toISOString() ?? null,
      linkedEmployees: linked,
      unlinkedEmployees: unlinked,
      pendingRun: pending,
      unmappedCodes: unmappedDepartments + unmappedPositions,
    };
  }

  /** Never surfaces a response body — only counts and metadata. */
  async probe(): Promise<{ ok: boolean; message: string; total?: number; companyCode?: string }> {
    try {
      const result = await this.client.probe();
      return {
        ok: true,
        message: `Reached the HRIS: ${result.total} record(s) for company ${result.companyCode}.`,
        total: result.total,
        companyCode: result.companyCode,
      };
    } catch (error) {
      if (error instanceof HrisTransportError || error instanceof HrisPayloadError) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: 'Unexpected failure reaching the HRIS.' };
    }
  }

  async runs(query: QueryRunsDto): Promise<{ data: HrisRunView[] }> {
    const rows = await this.prisma.hrisSyncRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 20,
    });
    return { data: rows.map((row) => this.toRunView(row, false)) };
  }

  async run(id: string): Promise<HrisRunView> {
    const row = await this.prisma.hrisSyncRun.findUnique({
      where: { id },
      include: { issues: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Sync run not found.');
    return this.toRunView(row, true);
  }

  async queue(user: AuthUser, dto: QueueRunDto): Promise<{ id: string }> {
    const run = await this.sync.queueRun({
      trigger: HrisSyncTrigger.MANUAL,
      dryRun: dto.dryRun ?? false,
      requestedById: user.id,
    });
    await this.audit.log({
      action: dto.dryRun ? 'hris.dry_run_queued' : 'hris.sync_queued',
      resourceType: 'hris_sync',
      resourceId: run.id,
      actor: user.id,
      newValues: { dryRun: dto.dryRun ?? false },
    });
    return run;
  }

  async mappings(): Promise<HrisMappingsView> {
    const [departmentMaps, positionMaps, departments, positions] = await Promise.all([
      this.prisma.hrisDepartmentMap.findMany({
        orderBy: { hrisCode: 'asc' },
        include: { department: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.hrisPositionMap.findMany({
        orderBy: { hrisCode: 'asc' },
        include: { position: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.department.findMany({
        where: { isActive: true, archivedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.position.findMany({
        where: { isActive: true, archivedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      }),
    ]);

    return {
      departments: departmentMaps.map((row) => ({
        id: row.id,
        hrisCode: row.hrisCode,
        target: row.department,
        autoSuggested: row.autoSuggested,
      })),
      positions: positionMaps.map((row) => ({
        id: row.id,
        hrisCode: row.hrisCode,
        target: row.position,
        autoSuggested: row.autoSuggested,
      })),
      availableDepartments: departments,
      availablePositions: positions,
    };
  }

  /**
   * Creates a GEM-ENI department/position for each HRIS code that has no
   * target, and points the mapping at it.
   *
   * Deliberately a separate, explicit action rather than something the sync
   * does: a nightly job that invents organisational records would turn a typo
   * upstream into a permanent junk department. Here a person pressed the
   * button, the result is audited, and the run reports exactly what it made.
   *
   * The feed carries codes but no names — we only asked for codes, since a
   * name that drifts upstream would look like a new department. So the new
   * records are named after the code; rename them in Lookups if you want
   * something friendlier. The code is what matching depends on.
   */
  async adoptUnmappedCodes(
    user: AuthUser,
  ): Promise<{ mappings: HrisMappingsView; createdDepartments: string[]; createdPositions: string[]; linkedExisting: string[] }> {
    const createdDepartments: string[] = [];
    const createdPositions: string[] = [];
    const linkedExisting: string[] = [];

    const departmentMaps = await this.prisma.hrisDepartmentMap.findMany({
      where: { departmentId: null },
    });
    for (const mapping of departmentMaps) {
      /*
       * A code may already exist but be inactive or archived, in which case
       * creating would collide on the unique code. Point at it and say so —
       * reactivating someone else's archived record is not this action's call.
       */
      const existing = await this.prisma.department.findUnique({
        where: { code: mapping.hrisCode },
        select: { id: true, isActive: true, archivedAt: true },
      });
      if (existing) {
        await this.prisma.hrisDepartmentMap.update({
          where: { id: mapping.id },
          data: { departmentId: existing.id, autoSuggested: false },
        });
        linkedExisting.push(
          existing.isActive && !existing.archivedAt
            ? `department ${mapping.hrisCode}`
            : `department ${mapping.hrisCode} (inactive — activate it in Lookups)`,
        );
        continue;
      }
      const created = await this.prisma.department.create({
        data: { code: mapping.hrisCode, name: mapping.hrisName ?? mapping.hrisCode },
        select: { id: true, code: true, name: true },
      });
      await this.prisma.hrisDepartmentMap.update({
        where: { id: mapping.id },
        data: { departmentId: created.id, autoSuggested: false },
      });
      createdDepartments.push(created.code);
      await this.audit.log({
        action: 'department.created',
        resourceType: 'department',
        resourceId: created.id,
        actor: user.id,
        newValues: { code: created.code, name: created.name },
        reason: 'Adopted from the HRIS employee feed',
      });
    }

    const positionMaps = await this.prisma.hrisPositionMap.findMany({
      where: { positionId: null },
    });
    for (const mapping of positionMaps) {
      const existing = await this.prisma.position.findUnique({
        where: { code: mapping.hrisCode },
        select: { id: true, isActive: true, archivedAt: true },
      });
      if (existing) {
        await this.prisma.hrisPositionMap.update({
          where: { id: mapping.id },
          data: { positionId: existing.id, autoSuggested: false },
        });
        linkedExisting.push(
          existing.isActive && !existing.archivedAt
            ? `position ${mapping.hrisCode}`
            : `position ${mapping.hrisCode} (inactive — activate it in Lookups)`,
        );
        continue;
      }
      const created = await this.prisma.position.create({
        data: { code: mapping.hrisCode, name: mapping.hrisName ?? mapping.hrisCode },
        select: { id: true, code: true, name: true },
      });
      await this.prisma.hrisPositionMap.update({
        where: { id: mapping.id },
        data: { positionId: created.id, autoSuggested: false },
      });
      createdPositions.push(created.code);
      await this.audit.log({
        action: 'position.created',
        resourceType: 'position',
        resourceId: created.id,
        actor: user.id,
        newValues: { code: created.code, name: created.name },
        reason: 'Adopted from the HRIS employee feed',
      });
    }

    await this.audit.log({
      action: 'hris.codes_adopted',
      resourceType: 'hris_sync',
      actor: user.id,
      newValues: { createdDepartments, createdPositions, linkedExisting },
    });

    return {
      mappings: await this.mappings(),
      createdDepartments,
      createdPositions,
      linkedExisting,
    };
  }

  async setDepartmentMap(
    user: AuthUser,
    id: string,
    dto: UpdateDepartmentMapDto,
  ): Promise<HrisMappingsView> {
    const existing = await this.prisma.hrisDepartmentMap.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Department mapping not found.');
    if (dto.departmentId) {
      const target = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, isActive: true, archivedAt: null },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('That department does not exist or is inactive.');
    }
    await this.prisma.hrisDepartmentMap.update({
      where: { id },
      // A human has now decided, so the suggestion flag comes off.
      data: { departmentId: dto.departmentId ?? null, autoSuggested: false },
    });
    await this.audit.log({
      action: 'hris.department_map_updated',
      resourceType: 'hris_department_map',
      resourceId: id,
      actor: user.id,
      oldValues: { departmentId: existing.departmentId },
      newValues: { departmentId: dto.departmentId ?? null },
    });
    return this.mappings();
  }

  async setPositionMap(
    user: AuthUser,
    id: string,
    dto: UpdatePositionMapDto,
  ): Promise<HrisMappingsView> {
    const existing = await this.prisma.hrisPositionMap.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Position mapping not found.');
    if (dto.positionId) {
      const target = await this.prisma.position.findFirst({
        where: { id: dto.positionId, isActive: true, archivedAt: null },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('That position does not exist or is inactive.');
    }
    await this.prisma.hrisPositionMap.update({
      where: { id },
      data: { positionId: dto.positionId ?? null, autoSuggested: false },
    });
    await this.audit.log({
      action: 'hris.position_map_updated',
      resourceType: 'hris_position_map',
      resourceId: id,
      actor: user.id,
      oldValues: { positionId: existing.positionId },
      newValues: { positionId: dto.positionId ?? null },
    });
    return this.mappings();
  }

  private toRunView(
    row: {
      id: string;
      trigger: HrisSyncTrigger;
      dryRun: boolean;
      status: HrisSyncStatus;
      startedAt: Date | null;
      finishedAt: Date | null;
      companyCode: string | null;
      producerTotal: number | null;
      pagesFetched: number | null;
      created: number;
      linked: number;
      updated: number;
      unchanged: number;
      skipped: number;
      failed: number;
      error: string | null;
      createdAt: Date;
      issues?: Array<{
        id: string;
        severity: string;
        code: string;
        employeeNumber: string | null;
        employeeId: string | null;
        message: string;
      }>;
    },
    withIssues: boolean,
  ): HrisRunView {
    return {
      id: row.id,
      trigger: row.trigger,
      dryRun: row.dryRun,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      companyCode: row.companyCode,
      producerTotal: row.producerTotal,
      pagesFetched: row.pagesFetched,
      counts: {
        created: row.created,
        linked: row.linked,
        updated: row.updated,
        unchanged: row.unchanged,
        skipped: row.skipped,
        failed: row.failed,
      },
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      ...(withIssues && row.issues
        ? {
            issues: row.issues.map((issue) => ({
              id: issue.id,
              severity: issue.severity,
              code: issue.code,
              employeeNumber: issue.employeeNumber,
              employeeId: issue.employeeId,
              message: issue.message,
            })),
          }
        : {}),
    };
  }
}
