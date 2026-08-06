import { Workbook, type CellValue } from 'exceljs';
import { AppException } from '../common/errors/app.exception';
import type { CsvRow } from './import-row-validators';

/**
 * XLSX parsing for staged imports (spec §24 supports CSV and XLSX). The first
 * worksheet's first row is the header; every following row becomes a
 * string-keyed record exactly like the CSV parser produces, so validators and
 * writers are shared between both formats.
 *
 * Cell values are normalized to trimmed strings: numbers via toString (no
 * locale formatting), dates as YYYY-MM-DD, formulas/hyperlinks/rich text by
 * their displayed result. Fully empty rows are skipped.
 */

/** Convert one exceljs cell value to the string a CSV cell would hold. */
export function cellToString(value: CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text ?? '')
        .join('')
        .trim();
    }
    if ('result' in value && value.result !== undefined) {
      // Formula cell — use the computed result. Error results become ''.
      const result = value.result as CellValue;
      return typeof result === 'object' && result !== null && 'error' in result
        ? ''
        : cellToString(result);
    }
    if ('text' in value && typeof value.text === 'string') {
      // Hyperlink cell — displayed text.
      return value.text.trim();
    }
    if ('error' in value) {
      return '';
    }
  }
  return String(value).trim();
}

/**
 * Parse an XLSX buffer into CSV-equivalent rows. Throws the same
 * VALIDATION_ERROR envelope the CSV parser produces for unusable files.
 */
export async function parseXlsxToRows(buffer: Buffer): Promise<CsvRow[]> {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw AppException.validation([
      { field: 'file', message: 'The file is not a parseable XLSX workbook.' },
    ]);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    throw AppException.validation([
      { field: 'file', message: 'The workbook contains no worksheet data.' },
    ]);
  }

  // Header row: column index → header name (blank headers are ignored).
  const headers = new Map<number, string>();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = cellToString(cell.value);
    if (header !== '') {
      headers.set(colNumber, header);
    }
  });
  if (headers.size === 0) {
    throw AppException.validation([
      { field: 'file', message: 'The first worksheet row must contain column headers.' },
    ]);
  }

  const rows: CsvRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const record: CsvRow = {};
    let hasValue = false;
    for (const [colNumber, header] of headers) {
      const text = cellToString(row.getCell(colNumber).value);
      record[header] = text;
      if (text !== '') {
        hasValue = true;
      }
    }
    if (hasValue) {
      rows.push(record);
    }
  });
  return rows;
}
