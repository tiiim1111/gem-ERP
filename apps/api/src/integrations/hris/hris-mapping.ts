/*
 * Status mapping and the per-row reconciliation decision, as pure functions.
 *
 * The decision is deliberately separated from the writing so a dry run can
 * take the identical path and only the final apply step differs. A rehearsal
 * that runs different code proves nothing about the real run.
 */

import { EmployeeStatus } from '@prisma/client';
import type { HrisEmployee } from './hris-payload';

/** Stable machine codes for issues, matching HrisSyncIssue.code. */
export const HRIS_ISSUE = {
  unmappedDepartment: 'UNMAPPED_DEPARTMENT',
  unmappedPosition: 'UNMAPPED_POSITION',
  unknownStatus: 'UNKNOWN_STATUS',
  ambiguousMatch: 'AMBIGUOUS_MATCH',
  duplicateEmployeeNumber: 'DUPLICATE_EMPLOYEE_NUMBER',
  emailConflict: 'EMAIL_CONFLICT',
  missingFromSnapshot: 'MISSING_FROM_SNAPSHOT',
  archivedInactive: 'ARCHIVED_INACTIVE',
  inferredSeparationWithAssets: 'INFERRED_SEPARATION_WITH_ASSETS',
  noDefaultBranch: 'NO_DEFAULT_BRANCH',
  employeeNumberConflict: 'EMPLOYEE_NUMBER_CONFLICT',
  writeFailed: 'WRITE_FAILED',
} as const;

export type HrisIssueCode = (typeof HRIS_ISSUE)[keyof typeof HRIS_ISSUE];

/**
 * Raw HRIS employment status to GEM-ENI's four states, as agreed in
 * docs/hris-employee-api-phase2-decisions.md §4.
 *
 * GEM-ENI's SUSPENDED has no HRIS source and stays available for manual use.
 */
const STATUS_MAP: Record<string, EmployeeStatus> = {
  ACTIVE: EmployeeStatus.ACTIVE,
  INACTIVE: EmployeeStatus.INACTIVE,
  RESIGNED: EmployeeStatus.SEPARATED,
  TERMINATED: EmployeeStatus.SEPARATED,
};

export interface StatusMapping {
  status: EmployeeStatus;
  /**
   * True when the raw value is not in the agreed set. The row still syncs as
   * INACTIVE — the safe end — but is flagged, never quietly guessed at.
   */
  unknown: boolean;
}

export function mapEmploymentStatus(raw: string): StatusMapping {
  const mapped = STATUS_MAP[raw.trim().toUpperCase()];
  if (mapped) return { status: mapped, unknown: false };
  return { status: EmployeeStatus.INACTIVE, unknown: true };
}

export function isSeparated(status: EmployeeStatus): boolean {
  return status === EmployeeStatus.SEPARATED;
}

/** The GEM-ENI employee row the engine needs in order to decide. */
export interface ExistingEmployee {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  displayName: string | null;
  workEmail: string | null;
  departmentId: string | null;
  positionId: string | null;
  status: EmployeeStatus;
  startDate: Date | null;
  separationDate: Date | null;
  separationDateInferred: boolean;
  hrisId: string | null;
}

export interface ResolvedLookups {
  /** HRIS department code -> GEM-ENI department id, or null when unmapped. */
  departmentId: string | null;
  positionId: string | null;
}

export interface RowIssue {
  code: HrisIssueCode;
  severity: 'ERROR' | 'REVIEW';
  message: string;
}

export type RowAction = 'create' | 'link' | 'update' | 'unchanged' | 'skip';

export interface RowDecision {
  action: RowAction;
  /** Set for link/update/unchanged. */
  employeeId?: string;
  /** Fields to write. Only ever the HRIS-owned set. */
  data?: HrisOwnedFields;
  issues: RowIssue[];
}

/**
 * The only fields a sync may write.
 *
 * Branch, supervisor, department-head assignment, the linked login account,
 * notes, photo and all asset custody are GEM-ENI's and are absent here by
 * construction — so no amount of producer data can reach them.
 */
export interface HrisOwnedFields {
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  workEmail: string | null;
  departmentId: string | null;
  positionId: string | null;
  status: EmployeeStatus;
  startDate: Date | null;
  separationDate: Date | null;
  separationDateInferred: boolean;
  hrisUpdatedAt: Date;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

export interface DecideInput {
  feed: HrisEmployee;
  existing: ExistingEmployee | null;
  lookups: ResolvedLookups;
  /** True when the feed sent a department/position code we have not mapped. */
  departmentUnmapped: boolean;
  positionUnmapped: boolean;
  /** Employee number appears more than once in this snapshot. */
  duplicateInSnapshot: boolean;
  /** Another GEM-ENI employee already holds this work email. */
  emailTakenByOther: boolean;
  /** Another GEM-ENI employee already holds this employee number. */
  employeeNumberTakenByOther: boolean;
  /** Needed to create a row at all; null means none is configured/valid. */
  defaultBranchId: string | null;
  /** The instant the run started — the inferred separation date. */
  observedAt: Date;
}

/**
 * Decides what one feed row means for GEM-ENI.
 *
 * Skips are per-row on purpose: one unmapped department must not stop the
 * other eleven people from syncing, and the run finishes REVIEW_REQUIRED so
 * the problem is visible rather than silently dropped.
 */
export function decideRow(input: DecideInput): RowDecision {
  const { feed, existing, lookups, observedAt } = input;
  const issues: RowIssue[] = [];

  if (input.duplicateInSnapshot) {
    return {
      action: 'skip',
      employeeId: existing?.id,
      issues: [
        {
          code: HRIS_ISSUE.duplicateEmployeeNumber,
          severity: 'ERROR',
          message:
            `Employee number ${feed.employeeNumber} appears more than once in the snapshot. ` +
            'GEM-ENI requires it to be unique, so these rows are quarantined until the HRIS is corrected.',
        },
      ],
    };
  }

  /*
   * An unmapped department or position leaves that one field empty — it does
   * not hold the person back.
   *
   * Both are optional on an employee, and neither is what asset custody runs
   * on: that needs the number, the name and the status. Skipping somebody
   * because a code is unmapped would block the custodian of a laptop over
   * reporting metadata, and would make mapping ten codes a precondition for
   * the feed working at all. Flagged for review so it still gets fixed.
   */
  if (input.departmentUnmapped) {
    issues.push({
      code: HRIS_ISSUE.unmappedDepartment,
      severity: 'REVIEW',
      message:
        `HRIS department code "${feed.departmentCode}" is not mapped, so this employee has no ` +
        'department. Everything else synced. Map it on the integration page and run again.',
    });
  }
  if (input.positionUnmapped) {
    issues.push({
      code: HRIS_ISSUE.unmappedPosition,
      severity: 'REVIEW',
      message:
        `HRIS position code "${feed.positionCode}" is not mapped, so this employee has no ` +
        'position. Everything else synced. Map it on the integration page and run again.',
    });
  }

  if (input.employeeNumberTakenByOther) {
    return {
      action: 'skip',
      employeeId: existing?.id,
      issues: [
        {
          code: HRIS_ISSUE.employeeNumberConflict,
          severity: 'ERROR',
          message:
            `Employee number ${feed.employeeNumber} already belongs to a different GEM-ENI employee. ` +
            'Resolve the duplicate by hand — the sync will not reassign it.',
        },
      ],
    };
  }

  const mapping = mapEmploymentStatus(feed.employmentStatus);
  if (mapping.unknown) {
    issues.push({
      code: HRIS_ISSUE.unknownStatus,
      severity: 'REVIEW',
      message:
        `Unrecognised HRIS status "${feed.employmentStatus}". Treated as INACTIVE — ` +
        'confirm the intended mapping rather than relying on this default.',
    });
  }

  /*
   * An email another employee already holds is dropped for this row rather
   * than written: GEM-ENI's work email is unique, and overwriting the other
   * person's address to resolve a producer-side duplicate would damage a
   * record that is not even part of this change.
   */
  let workEmail = feed.workEmail;
  if (workEmail && input.emailTakenByOther) {
    workEmail = null;
    issues.push({
      code: HRIS_ISSUE.emailConflict,
      severity: 'REVIEW',
      message:
        'The work email in the feed already belongs to another GEM-ENI employee. ' +
        'Left empty on this record; no existing address was overwritten.',
    });
  }

  if (feed.archivedAt && mapping.status === EmployeeStatus.INACTIVE) {
    issues.push({
      code: HRIS_ISSUE.archivedInactive,
      severity: 'REVIEW',
      message:
        'Archived in the HRIS, which forces INACTIVE there. Confirm whether this person has ' +
        'actually left — archiving is an administrative action, not a separation.',
    });
  }

  const startDate = toDate(feed.dateHired);

  /*
   * The HRIS has no separation date. When a separation first appears, the
   * observation date is recorded and marked inferred so the asset-clearance
   * workflow can run; an existing date is never overwritten, and the archive
   * timestamp is never used for this.
   */
  let separationDate = existing?.separationDate ?? null;
  let separationDateInferred = existing?.separationDateInferred ?? false;
  let newlySeparated = false;
  if (isSeparated(mapping.status)) {
    if (!existing || !isSeparated(existing.status)) {
      newlySeparated = true;
    }
    if (separationDate === null) {
      separationDate = observedAt;
      separationDateInferred = true;
    }
  }

  const data: HrisOwnedFields = {
    employeeNumber: feed.employeeNumber,
    firstName: feed.firstName,
    middleName: feed.middleName,
    lastName: feed.lastName,
    workEmail,
    departmentId: input.departmentUnmapped ? null : lookups.departmentId,
    positionId: input.positionUnmapped ? null : lookups.positionId,
    status: mapping.status,
    startDate,
    separationDate,
    separationDateInferred,
    hrisUpdatedAt: new Date(feed.updatedAt),
  };

  if (newlySeparated) {
    issues.push({
      code: HRIS_ISSUE.inferredSeparationWithAssets,
      severity: 'REVIEW',
      message:
        'Newly separated in the HRIS. Any assets still in this person\'s custody need clearance; ' +
        'the employee record and its history are kept.',
    });
  }

  if (!existing) {
    if (!input.defaultBranchId) {
      return {
        action: 'skip',
        issues: [
          ...issues,
          {
            code: HRIS_ISSUE.noDefaultBranch,
            severity: 'ERROR',
            message:
              'No valid default branch is configured, and GEM-ENI requires a branch on every ' +
              'employee. Set GEMENI_HRIS_DEFAULT_BRANCH_CODE to an active branch, then run again.',
          },
        ],
      };
    }
    return { action: 'create', data, issues };
  }

  const action: RowAction = existing.hrisId === null ? 'link' : unchanged(existing, data) ? 'unchanged' : 'update';
  return { action, employeeId: existing.id, data, issues };
}

/**
 * Whether applying `next` would change anything the sync owns.
 *
 * Used so a nightly run over an unchanged snapshot reports "unchanged" instead
 * of bumping the version and the audit trail on every employee every night.
 */
function unchanged(existing: ExistingEmployee, next: HrisOwnedFields): boolean {
  return (
    existing.employeeNumber === next.employeeNumber &&
    existing.firstName === next.firstName &&
    (existing.middleName ?? null) === next.middleName &&
    existing.lastName === next.lastName &&
    (existing.workEmail ?? null) === next.workEmail &&
    (existing.departmentId ?? null) === next.departmentId &&
    (existing.positionId ?? null) === next.positionId &&
    existing.status === next.status &&
    sameDay(existing.startDate, next.startDate) &&
    sameDay(existing.separationDate, next.separationDate) &&
    existing.separationDateInferred === next.separationDateInferred
  );
}

/** Display name GEM-ENI builds itself — the HRIS has no such column. */
export function buildDisplayName(feed: HrisEmployee): string {
  return `${feed.firstName} ${feed.lastName}`.replace(/\s+/g, ' ').trim();
}
