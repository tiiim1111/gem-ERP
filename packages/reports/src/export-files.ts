/**
 * Export format catalog shared by the API (validation, download headers) and
 * the worker (render dispatch + file naming).
 */
import { renderCsv } from './render/csv';
import { renderPdfTable } from './render/pdf';
import { renderXlsx } from './render/xlsx';
import type { ReportDefinition, ReportRow } from './types';

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** e.g. "stock-on-hand-20260806-093000.xlsx" */
export function exportFileName(reportKey: string, format: ExportFormat, at = new Date()): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${reportKey}-${stamp}.${format}`;
}

export interface RenderExportInput {
  definition: ReportDefinition;
  rows: ReportRow[];
  includeCost: boolean;
  format: ExportFormat;
  /** Filter summary for the PDF subtitle (e.g. "branchId=…, from=…"). */
  filterSummary?: string;
  truncated?: boolean;
}

/** Render one export file — the single dispatch used by the worker. */
export async function renderExport(input: RenderExportInput): Promise<Buffer> {
  const { definition, rows, includeCost, format } = input;
  switch (format) {
    case 'csv':
      return Buffer.from(renderCsv(definition.columns, rows, includeCost), 'utf8');
    case 'xlsx':
      return renderXlsx(definition.columns, rows, includeCost, {
        title: definition.title,
      });
    case 'pdf':
      return renderPdfTable(definition.columns, rows, includeCost, {
        title: definition.title,
        subtitle: input.filterSummary,
        truncatedNote: input.truncated
          ? `Row limit reached — this file contains the first ${rows.length.toLocaleString('en-US')} rows only. Narrow the filters for a complete export.`
          : undefined,
      });
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported export format: ${String(exhaustive)}`);
    }
  }
}
