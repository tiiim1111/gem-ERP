/**
 * Pure filter validation + query-fragment helpers shared by every report
 * definition. The API validates at request/enqueue time; the worker
 * re-validates defensively before running an export.
 */
import type {
  ReportContext,
  ReportDefinition,
  ReportFilterError,
  ReportFilterKey,
  ReportFilters,
} from './types';
import { REPORT_FILTER_KEYS } from './types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

const UUID_FILTER_KEYS: readonly ReportFilterKey[] = [
  'branchId',
  'warehouseId',
  'categoryId',
  'itemId',
  'employeeId',
  'departmentId',
  'supplierId',
];

/**
 * Validate raw filters against one report definition. Returns an empty array
 * when everything is acceptable. Unknown/unsupported filters are rejected —
 * never silently ignored (a filter the query does not apply would produce
 * misleadingly broad results).
 */
export function validateReportFilters(
  definition: ReportDefinition,
  filters: ReportFilters,
): ReportFilterError[] {
  const errors: ReportFilterError[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') {
      continue;
    }
    const filterKey = key as ReportFilterKey;
    if (!REPORT_FILTER_KEYS.includes(filterKey)) {
      errors.push({ field: key, message: `unknown filter "${key}"` });
      continue;
    }
    if (!definition.filters.includes(filterKey)) {
      errors.push({
        field: key,
        message: `report "${definition.key}" does not support the "${key}" filter`,
      });
      continue;
    }
    if (UUID_FILTER_KEYS.includes(filterKey) && !UUID_RE.test(value)) {
      errors.push({ field: key, message: `${key} must be a UUID` });
    }
    if ((filterKey === 'from' || filterKey === 'to') && !ISO_DATE_RE.test(value)) {
      errors.push({
        field: key,
        message: `${key} must be an ISO-8601 date (YYYY-MM-DD)`,
      });
    }
    if (filterKey === 'status' && definition.statusOptions) {
      if (!definition.statusOptions.includes(value)) {
        errors.push({
          field: key,
          message: `status must be one of [${definition.statusOptions.join(', ')}]`,
        });
      }
    }
  }
  return errors;
}

/** Inclusive lower bound: start of the given day, UTC. */
export function fromDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/** Inclusive upper bound: end of the given day, UTC (date-only columns store midnight, still <= this). */
export function toDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T23:59:59.999Z`);
}

/** Prisma date-range fragment for from/to filters; undefined when neither set. */
export function dateRange(
  filters: ReportFilters,
): { gte?: Date; lte?: Date } | undefined {
  if (!filters.from && !filters.to) {
    return undefined;
  }
  return {
    ...(filters.from ? { gte: fromDate(filters.from) } : {}),
    ...(filters.to ? { lte: toDate(filters.to) } : {}),
  };
}

/**
 * Effective branch restriction after combining the caller's scope with an
 * explicit branchId filter: null = unrestricted. The explicit branch is
 * intersected with the scope defensively — even though callers assert scope
 * before running, an out-of-scope branchId can never widen visibility.
 */
export function effectiveBranchIds(ctx: ReportContext): string[] | null {
  const explicit = ctx.filters.branchId;
  if (explicit) {
    if (ctx.branchIds !== null && !ctx.branchIds.includes(explicit)) {
      return [];
    }
    return [explicit];
  }
  return ctx.branchIds;
}

/** Prisma `branchId` where-fragment for the effective scope (undefined = no restriction). */
export function branchWhere(ctx: ReportContext): { in: string[] } | undefined {
  const ids = effectiveBranchIds(ctx);
  return ids === null ? undefined : { in: ids };
}

/** YYYY-MM-DD for @db.Date columns; null-safe. */
export function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Full ISO timestamp; null-safe. */
export function isoDateTime(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Decimal/number → string (money and quantities serialize as strings, §1.1); null-safe. */
export function decimalString(
  value: { toString(): string } | null | undefined,
): string | null {
  return value === null || value === undefined ? null : value.toString();
}
