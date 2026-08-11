/**
 * XLSX renderer (exceljs — already the house XLSX library from Phase 3.5
 * imports). One worksheet, bold header row, frozen top row, auto filter.
 */
import ExcelJS from 'exceljs';
import type { ReportColumn, ReportRow } from '../types';

export interface XlsxRenderOptions {
  /** Worksheet name / document title (defaults to "Report"). */
  title?: string;
}

export async function renderXlsx(
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  includeCost: boolean,
  options: XlsxRenderOptions = {},
): Promise<Buffer> {
  const visible = columns.filter((column) => !column.cost || includeCost);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GEM ERP';
  workbook.created = new Date();
  // Worksheet names max 31 chars and cannot contain []*?/\: characters.
  const sheetName = (options.title ?? 'Report')
    .replace(/[[\]*?/\\:]/g, ' ')
    .slice(0, 31)
    .trim() || 'Report';
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = visible.map((column) => ({
    header: column.header,
    key: column.key,
    width: Math.max(12, Math.round((column.width ?? 1) * 18)),
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        visible.map((column) => [column.key, row[column.key] ?? null]),
      ),
    );
  }
  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: visible.length },
    };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
