/*
 * The reconciliation engine.
 *
 * Pulls the full HRIS snapshot and brings GEM-ENI's employee rows in line with
 * it. Three rules shape everything here:
 *
 *  - Only the HRIS-owned fields are ever written. Branch, supervisor,
 *    department-head assignment, the linked login account, notes and all asset
 *    custody belong to GEM-ENI and are untouched.
 *  - A dry run takes the identical decision path and simply does not apply.
 *  - Nothing is ever deleted, archived or deactivated because it is missing
 *    from a snapshot. An employee record is what ties a missing laptop to a
 *    name, so an unexplained absence is reported, never acted on.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  EmployeeStatus,
  HrisSyncIssueSeverity,
  HrisSyncStatus,
  HrisSyncTrigger,
  Prisma,
} from '@prisma/client';
import { ROLE_CODES } from '@gemerp/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { HrisClientService, HrisTransportError } from './hris-client.service';
import {
  duplicateEmployeeNumbers,
  duplicateWorkEmails,
  HrisPayloadError,
  type HrisEmployee,
  type HrisSnapshot,
} from './hris-payload';
import {
  buildDisplayName,
  decideRow,
  HRIS_ISSUE,
  isSeparated,
  type ExistingEmployee,
  type RowDecision,
  type RowIssue,
} from './hris-mapping';

/**
 * Postgres advisory-lock key. Shared by the API poller and anything else that
 * might execute a run, so a manual and a scheduled run can never overlap even
 * across replicas.
 */
const SYNC_LOCK_KEY = 8_531_207_441_001n;

/** Cap on stored issues per run, so a broken feed cannot fill the table. */
const MAX_ISSUES_PER_RUN = 500;

interface RunCounts {
  created: number;
  linked: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class HrisSyncService {
  private readonly logger = new Logger(HrisSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly client: HrisClientService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Queues a run. The poller picks it up; nothing is executed here, which
   * keeps the HTTP request fast and means a manual run goes through exactly
   * the same path as a scheduled one.
   */
  async queueRun(input: {
    trigger: HrisSyncTrigger;
    dryRun: boolean;
    requestedById?: string | null;
  }): Promise<{ id: string }> {
    const existing = await this.prisma.hrisSyncRun.findFirst({
      where: { status: { in: [HrisSyncStatus.QUEUED, HrisSyncStatus.RUNNING] } },
      select: { id: true },
    });
    if (existing) {
      // Collapsing onto the pending run keeps an impatient double-click from
      // stacking identical reconciliations.
      return existing;
    }
    const run = await this.prisma.hrisSyncRun.create({
      data: {
        trigger: input.trigger,
        dryRun: input.dryRun,
        status: HrisSyncStatus.QUEUED,
        requestedById: input.requestedById ?? null,
      },
      select: { id: true },
    });
    return run;
  }

  /**
   * Claims and executes the oldest queued run, if any.
   *
   * Returns the run id when one was processed. The advisory lock is held for
   * the whole run and released in `finally`, so a crash cannot leave the
   * integration permanently locked (the session ends and Postgres drops it).
   */
  async drainOnce(): Promise<string | null> {
    const locked = await this.tryLock();
    if (!locked) return null;
    try {
      const queued = await this.prisma.hrisSyncRun.findFirst({
        where: { status: HrisSyncStatus.QUEUED },
        orderBy: { createdAt: 'asc' },
        select: { id: true, dryRun: true },
      });
      if (!queued) return null;

      // updateMany so two racing drains cannot both claim the same row even if
      // the lock were somehow bypassed.
      const claimed = await this.prisma.hrisSyncRun.updateMany({
        where: { id: queued.id, status: HrisSyncStatus.QUEUED },
        data: { status: HrisSyncStatus.RUNNING, startedAt: new Date() },
      });
      if (claimed.count === 0) return null;

      await this.execute(queued.id, queued.dryRun);
      return queued.id;
    } finally {
      await this.unlock();
    }
  }

  private async tryLock(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_lock(${SYNC_LOCK_KEY}::bigint) AS locked`,
    );
    return rows[0]?.locked === true;
  }

  private async unlock(): Promise<void> {
    try {
      await this.prisma.$queryRaw(
        Prisma.sql`SELECT pg_advisory_unlock(${SYNC_LOCK_KEY}::bigint)`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not release the HRIS sync lock: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  private async execute(runId: string, dryRun: boolean): Promise<void> {
    const observedAt = new Date();
    const issues: Array<RowIssue & { hrisId?: string; employeeNumber?: string; employeeId?: string }> = [];
    const counts: RunCounts = {
      created: 0,
      linked: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    };

    /*
     * Defence in depth behind the scheduler: a real run must not write while
     * the feed is disabled, however it got queued. Recorded on the run itself
     * so the reason is visible in the history rather than only in a log.
     */
    if (!dryRun && !this.config.hris.enabled) {
      const message =
        'Writing is disabled (GEMENI_HRIS_SYNC_ENABLED=false). Nothing was applied — ' +
        'use a dry run until the mappings and default branch have been reviewed.';
      await this.finish(runId, HrisSyncStatus.FAILED, counts, issues, { error: message });
      this.logger.warn(`HRIS sync run ${runId} refused: writing is disabled`);
      return;
    }

    let snapshot: HrisSnapshot;
    try {
      snapshot = await this.client.fetchSnapshot();
    } catch (error) {
      /*
       * A transport or payload failure means nothing is applied at all. This
       * is the case where "do nothing" is strictly correct: acting on half a
       * snapshot would look exactly like a wave of departures.
       */
      const message =
        error instanceof HrisTransportError || error instanceof HrisPayloadError
          ? error.message
          : `Unexpected sync failure: ${error instanceof Error ? error.message : String(error)}`;
      await this.finish(runId, HrisSyncStatus.FAILED, counts, issues, { error: message });
      await this.notifyAdmins(
        'hris.sync_failed',
        'HRIS employee sync failed',
        message,
        `hris-sync-failed:${runId}`,
      );
      this.logger.error(`HRIS sync run ${runId} failed: ${message}`);
      return;
    }

    const defaultBranchId = await this.resolveDefaultBranch();
    const duplicateNumbers = duplicateEmployeeNumbers(snapshot.employees);
    const duplicateEmails = duplicateWorkEmails(snapshot.employees);

    const departmentMap = await this.syncLookupMaps(snapshot.employees, dryRun);

    for (const feed of snapshot.employees) {
      try {
        const applied = await this.reconcileOne({
          feed,
          dryRun,
          observedAt,
          defaultBranchId,
          duplicateNumbers,
          duplicateEmails,
          departmentId: departmentMap.departments.get(feed.departmentCode ?? '') ?? null,
          positionId: departmentMap.positions.get(feed.positionCode ?? '') ?? null,
          departmentUnmapped:
            feed.departmentCode !== null &&
            !departmentMap.departments.get(feed.departmentCode),
          positionUnmapped:
            feed.positionCode !== null && !departmentMap.positions.get(feed.positionCode),
        });
        counts[applied.counted] += 1;
        for (const issue of applied.decision.issues) {
          issues.push({
            ...issue,
            hrisId: feed.hrisId,
            employeeNumber: feed.employeeNumber,
            employeeId: applied.employeeId,
          });
        }
      } catch (error) {
        counts.failed += 1;
        issues.push({
          code: HRIS_ISSUE.writeFailed,
          severity: 'ERROR',
          message: `Could not apply this record: ${error instanceof Error ? error.message : String(error)}`,
          hrisId: feed.hrisId,
          employeeNumber: feed.employeeNumber,
        });
      }
    }

    // Linked employees the snapshot no longer mentions. Reported only.
    const feedIds = new Set(snapshot.employees.map((employee) => employee.hrisId));
    const linkedRows = await this.prisma.employee.findMany({
      where: { hrisId: { not: null } },
      select: { id: true, hrisId: true, employeeNumber: true },
    });
    for (const row of linkedRows) {
      if (row.hrisId && !feedIds.has(row.hrisId)) {
        issues.push({
          code: HRIS_ISSUE.missingFromSnapshot,
          severity: 'REVIEW',
          message:
            'Previously linked to the HRIS but absent from this complete snapshot. Nothing was ' +
            'changed — confirm whether the person was removed there, or whether the feed is wrong.',
          hrisId: row.hrisId,
          employeeNumber: row.employeeNumber,
          employeeId: row.id,
        });
      }
    }

    const hasErrors = issues.some((issue) => issue.severity === 'ERROR');
    const status =
      hasErrors || issues.length > 0 ? HrisSyncStatus.REVIEW_REQUIRED : HrisSyncStatus.SUCCEEDED;

    await this.finish(runId, status, counts, issues, {
      companyCode: snapshot.companyCode,
      snapshot: true,
      producerTotal: snapshot.total,
      pagesFetched: snapshot.pagesFetched,
    });

    if (status === HrisSyncStatus.REVIEW_REQUIRED) {
      await this.notifyAdmins(
        'hris.sync_review',
        dryRun ? 'HRIS dry run needs review' : 'HRIS employee sync needs review',
        `${issues.length} item(s) need attention from the last run.`,
        `hris-sync-review:${runId}`,
      );
    }
    this.logger.log(
      `HRIS sync run ${runId}${dryRun ? ' (dry run)' : ''} finished ${status}: ` +
        `created ${counts.created}, linked ${counts.linked}, updated ${counts.updated}, ` +
        `unchanged ${counts.unchanged}, skipped ${counts.skipped}, failed ${counts.failed}`,
    );
  }

  /** Decides and (unless this is a dry run) applies one feed row. */
  private async reconcileOne(input: {
    feed: HrisEmployee;
    dryRun: boolean;
    observedAt: Date;
    defaultBranchId: string | null;
    duplicateNumbers: Set<string>;
    duplicateEmails: Set<string>;
    departmentId: string | null;
    positionId: string | null;
    departmentUnmapped: boolean;
    positionUnmapped: boolean;
  }): Promise<{ decision: RowDecision; counted: keyof RunCounts; employeeId?: string }> {
    const { feed } = input;

    const existingRow = await this.prisma.employee.findFirst({
      where: { hrisId: feed.hrisId },
      select: EXISTING_SELECT,
    });

    /*
     * Initial linking only, and only on an exact employee-number match of an
     * employee that is not already linked. Never by name, email, department or
     * position — a near-match would attach one person's asset custody to
     * another, which is not recoverable by rerunning the sync.
     */
    let existing: ExistingEmployee | null = existingRow;
    let ambiguous = false;
    if (!existing) {
      const candidates = await this.prisma.employee.findMany({
        where: { employeeNumber: feed.employeeNumber, hrisId: null, archivedAt: null },
        select: EXISTING_SELECT,
      });
      if (candidates.length === 1) {
        existing = candidates[0];
      } else if (candidates.length > 1) {
        ambiguous = true;
      }
    }

    if (ambiguous) {
      return {
        decision: {
          action: 'skip',
          issues: [
            {
              code: HRIS_ISSUE.ambiguousMatch,
              severity: 'ERROR',
              message:
                `More than one unlinked GEM-ENI employee carries number ${feed.employeeNumber}. ` +
                'Resolve by hand — the sync will not choose between them.',
            },
          ],
        },
        counted: 'skipped',
      };
    }

    const emailTakenByOther = feed.workEmail
      ? input.duplicateEmails.has(feed.workEmail.toLowerCase()) ||
        (await this.emailHeldByAnother(feed.workEmail, existing?.id))
      : false;
    const employeeNumberTakenByOther = await this.numberHeldByAnother(
      feed.employeeNumber,
      existing?.id,
    );

    const decision = decideRow({
      feed,
      existing,
      lookups: { departmentId: input.departmentId, positionId: input.positionId },
      departmentUnmapped: input.departmentUnmapped,
      positionUnmapped: input.positionUnmapped,
      duplicateInSnapshot: input.duplicateNumbers.has(feed.employeeNumber.toUpperCase()),
      emailTakenByOther,
      employeeNumberTakenByOther,
      defaultBranchId: input.defaultBranchId,
      observedAt: input.observedAt,
    });

    const counted: keyof RunCounts =
      decision.action === 'create'
        ? 'created'
        : decision.action === 'link'
          ? 'linked'
          : decision.action === 'update'
            ? 'updated'
            : decision.action === 'unchanged'
              ? 'unchanged'
              : 'skipped';

    if (input.dryRun || decision.action === 'skip' || decision.action === 'unchanged') {
      return { decision, counted, employeeId: decision.employeeId };
    }

    const data = decision.data!;
    const employeeId = await this.prisma.$transaction(async (tx) => {
      if (decision.action === 'create') {
        const created = await tx.employee.create({
          data: {
            ...data,
            displayName: buildDisplayName(feed),
            branchId: input.defaultBranchId!,
            hrisId: feed.hrisId,
            hrisSyncedAt: input.observedAt,
          },
          select: { id: true },
        });
        return created.id;
      }
      const updated = await tx.employee.update({
        where: { id: decision.employeeId! },
        data: {
          ...data,
          hrisId: feed.hrisId,
          hrisSyncedAt: input.observedAt,
          version: { increment: 1 },
        },
        select: { id: true },
      });
      return updated.id;
    });

    /*
     * Reported after the write, not before: an employee who leaves while still
     * holding assets must stay in GEM-ENI, and the clearance item is what gets
     * the laptop back.
     */
    if (isSeparated(data.status)) {
      const outstanding = await this.prisma.asset.count({
        where: { custodianId: employeeId, archivedAt: null },
      });
      if (outstanding > 0) {
        decision.issues.push({
          code: HRIS_ISSUE.inferredSeparationWithAssets,
          severity: 'REVIEW',
          message: `Separated with ${outstanding} asset(s) still in custody — clearance needed.`,
        });
      }
    }

    return { decision, counted, employeeId };
  }

  private async emailHeldByAnother(email: string, selfId?: string): Promise<boolean> {
    const row = await this.prisma.employee.findFirst({
      where: {
        workEmail: { equals: email, mode: 'insensitive' },
        ...(selfId ? { id: { not: selfId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  private async numberHeldByAnother(employeeNumber: string, selfId?: string): Promise<boolean> {
    const row = await this.prisma.employee.findFirst({
      where: {
        employeeNumber,
        ...(selfId ? { id: { not: selfId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * The branch new employees are filed under.
   *
   * Resolved per run rather than cached so a mis-set code can be corrected
   * without restarting the API. An inactive or unknown code resolves to null,
   * which makes every creation skip with a visible error instead of inventing
   * a placement.
   */
  private async resolveDefaultBranch(): Promise<string | null> {
    const code = this.config.hris.defaultBranchCode;
    if (!code) return null;
    const branch = await this.prisma.branch.findFirst({
      where: { code, isActive: true, archivedAt: null },
      select: { id: true },
    });
    if (!branch) {
      this.logger.warn(
        `GEMENI_HRIS_DEFAULT_BRANCH_CODE "${code}" does not match an active branch — new employees will be skipped`,
      );
    }
    return branch?.id ?? null;
  }

  /**
   * Records every department/position code the feed used and resolves it to a
   * GEM-ENI id.
   *
   * An unseen code is persisted with an exact-code suggestion when one exists,
   * flagged `autoSuggested` so it is visibly unreviewed, and left unmapped
   * otherwise. Organisational rows are never created from feed data.
   */
  private async syncLookupMaps(
    employees: readonly HrisEmployee[],
    dryRun: boolean,
  ): Promise<{ departments: Map<string, string | null>; positions: Map<string, string | null> }> {
    const departmentCodes = [
      ...new Set(employees.map((e) => e.departmentCode).filter((c): c is string => !!c)),
    ];
    const positionCodes = [
      ...new Set(employees.map((e) => e.positionCode).filter((c): c is string => !!c)),
    ];

    const departments = new Map<string, string | null>();
    const positions = new Map<string, string | null>();

    for (const code of departmentCodes) {
      let row = await this.prisma.hrisDepartmentMap.findUnique({ where: { hrisCode: code } });
      if (!row) {
        const match = await this.prisma.department.findFirst({
          where: { code, isActive: true, archivedAt: null },
          select: { id: true },
        });
        if (!dryRun) {
          row = await this.prisma.hrisDepartmentMap.create({
            data: {
              hrisCode: code,
              departmentId: match?.id ?? null,
              autoSuggested: match !== null,
            },
          });
        } else {
          departments.set(code, match?.id ?? null);
          continue;
        }
      }
      departments.set(code, row.departmentId);
    }

    for (const code of positionCodes) {
      let row = await this.prisma.hrisPositionMap.findUnique({ where: { hrisCode: code } });
      if (!row) {
        const match = await this.prisma.position.findFirst({
          where: { code, isActive: true, archivedAt: null },
          select: { id: true },
        });
        if (!dryRun) {
          row = await this.prisma.hrisPositionMap.create({
            data: {
              hrisCode: code,
              positionId: match?.id ?? null,
              autoSuggested: match !== null,
            },
          });
        } else {
          positions.set(code, match?.id ?? null);
          continue;
        }
      }
      positions.set(code, row.positionId);
    }

    return { departments, positions };
  }

  private async finish(
    runId: string,
    status: HrisSyncStatus,
    counts: RunCounts,
    issues: Array<RowIssue & { hrisId?: string; employeeNumber?: string; employeeId?: string }>,
    extra: {
      error?: string;
      companyCode?: string;
      snapshot?: boolean;
      producerTotal?: number;
      pagesFetched?: number;
    },
  ): Promise<void> {
    const stored = issues.slice(0, MAX_ISSUES_PER_RUN);
    await this.prisma.$transaction([
      this.prisma.hrisSyncRun.update({
        where: { id: runId },
        data: {
          status,
          finishedAt: new Date(),
          ...counts,
          error: extra.error ?? null,
          companyCode: extra.companyCode ?? null,
          snapshot: extra.snapshot ?? null,
          producerTotal: extra.producerTotal ?? null,
          pagesFetched: extra.pagesFetched ?? null,
        },
      }),
      this.prisma.hrisSyncIssue.createMany({
        data: stored.map((issue) => ({
          runId,
          severity:
            issue.severity === 'ERROR'
              ? HrisSyncIssueSeverity.ERROR
              : HrisSyncIssueSeverity.REVIEW,
          code: issue.code,
          hrisId: issue.hrisId ?? null,
          employeeNumber: issue.employeeNumber ?? null,
          employeeId: issue.employeeId ?? null,
          message: issue.message,
        })),
      }),
    ]);
  }

  /** Super admins only — these carry operational detail, not employee data. */
  private async notifyAdmins(
    type: string,
    title: string,
    message: string,
    dedupeKey: string,
  ): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        userRoles: { some: { role: { code: ROLE_CODES.superAdmin } } },
      },
      select: { id: true },
    });
    await this.notifications.notifyMany(
      admins.map((admin) => admin.id),
      { type, title, message, resourceType: 'hris_sync', link: '/settings/integrations', dedupeKey },
    );
  }
}

const EXISTING_SELECT = {
  id: true,
  employeeNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  displayName: true,
  workEmail: true,
  departmentId: true,
  positionId: true,
  status: true,
  startDate: true,
  separationDate: true,
  separationDateInferred: true,
  hrisId: true,
} satisfies Prisma.EmployeeSelect;

export { EmployeeStatus };
