/**
 * Phase 7 report registry contract (api-outline §8).
 *
 * One `ReportDefinition` per operational report is the single source of truth
 * for: the underlying permission (checked on top of report.view /
 * report.export), the cost-gating permission, the accepted §1.4 filters, the
 * column catalog, and the Prisma query builder. The API report endpoints,
 * the GET /reports catalog, and the worker's background exports all consume
 * the SAME definition — queries are never duplicated.
 *
 * This package is pure: no NestJS, no HTTP. Callers translate the returned
 * validation errors / thrown Errors into their own error envelopes.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** Prisma surface the report queries run against. */
export type ReportPrisma = PrismaClient | Prisma.TransactionClient;

/** §1.4 filter keys a report may accept (subset per report). */
export const REPORT_FILTER_KEYS = [
  'branchId',
  'warehouseId',
  'categoryId',
  'itemId',
  'employeeId',
  'departmentId',
  'supplierId',
  'status',
  'from',
  'to',
] as const;

export type ReportFilterKey = (typeof REPORT_FILTER_KEYS)[number];

export type ReportFilters = Partial<Record<ReportFilterKey, string>>;

/** One rendered cell value — already serialized (Decimals/Dates → strings). */
export type ReportCellValue = string | number | boolean | null;

/** One flat report row keyed by column key. */
export type ReportRow = Record<string, ReportCellValue>;

export interface ReportColumn {
  /** Row object key. */
  key: string;
  /** Human column header (CSV/XLSX/PDF and web tables). */
  header: string;
  /**
   * Cost-gated column: present in rows ONLY when the caller holds the
   * report's costPermission (ctx.includeCost).
   */
  cost?: boolean;
  /** Relative width hint for PDF table layout (default 1). */
  width?: number;
}

/** Everything a query builder needs — no user object crosses this boundary. */
export interface ReportContext {
  /**
   * Branch ids the caller may access, or null meaning unrestricted (super
   * admin). An empty array means access to no branches at all. The explicit
   * branchId filter (already asserted in-scope by the caller) narrows this
   * further via {@link effectiveBranchIds}.
   */
  branchIds: string[] | null;
  filters: ReportFilters;
  /** Caller holds the report's costPermission → cost columns included. */
  includeCost: boolean;
  skip: number;
  take: number;
}

export interface ReportResult {
  rows: ReportRow[];
  total: number;
}

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  /** Underlying permission required IN ADDITION to report.view / report.export. */
  permission: string;
  /** Permission unlocking the cost columns (absent = report has none). */
  costPermission?: string;
  /** Filter keys this report accepts; anything else is a validation error. */
  filters: readonly ReportFilterKey[];
  /** Allowed values for the `status` filter (when supported). */
  statusOptions?: readonly string[];
  columns: readonly ReportColumn[];
  run(prisma: ReportPrisma, ctx: ReportContext): Promise<ReportResult>;
}

/** Machine-readable filter validation failure (maps to VALIDATION_ERROR). */
export interface ReportFilterError {
  field: string;
  message: string;
}
