/**
 * Full-result runner for background exports: pages through a report
 * definition in fixed chunks until exhausted or the row cap is reached.
 * The API's paginated endpoints call `definition.run` directly instead.
 */
import type {
  ReportContext,
  ReportDefinition,
  ReportPrisma,
  ReportRow,
} from './types';

/** Hard cap on exported rows — keeps one export bounded in memory and time. */
export const EXPORT_ROW_LIMIT = 50_000;

/** Page size used while draining a report for export. */
export const EXPORT_CHUNK_SIZE = 1_000;

export interface FullReportResult {
  rows: ReportRow[];
  total: number;
  /** True when total exceeded {@link EXPORT_ROW_LIMIT} and rows were cut off. */
  truncated: boolean;
}

export async function runReportFull(
  definition: ReportDefinition,
  prisma: ReportPrisma,
  ctx: Omit<ReportContext, 'skip' | 'take'>,
  rowLimit: number = EXPORT_ROW_LIMIT,
): Promise<FullReportResult> {
  const rows: ReportRow[] = [];
  let total = 0;
  for (let skip = 0; skip < rowLimit; skip += EXPORT_CHUNK_SIZE) {
    const take = Math.min(EXPORT_CHUNK_SIZE, rowLimit - skip);
    const page = await definition.run(prisma, { ...ctx, skip, take });
    rows.push(...page.rows);
    total = page.total;
    if (skip + page.rows.length >= page.total || page.rows.length < take) {
      break;
    }
  }
  return { rows, total, truncated: total > rows.length };
}
