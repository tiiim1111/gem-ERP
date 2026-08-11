/**
 * CSV renderer (RFC 4180 quoting, CRLF row endings, UTF-8). Pure string
 * build — no streaming needed at the EXPORT_ROW_LIMIT scale.
 */
import type { ReportCellValue, ReportColumn, ReportRow } from '../types';

function escapeCell(value: ReportCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text =
    typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Render rows to CSV using the visible column subset (cost columns are
 * excluded unless includeCost).
 */
export function renderCsv(
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  includeCost: boolean,
): string {
  const visible = columns.filter((column) => !column.cost || includeCost);
  const lines = [visible.map((column) => escapeCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(
      visible.map((column) => escapeCell(row[column.key] ?? null)).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
