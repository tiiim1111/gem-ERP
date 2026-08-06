import { HttpException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { cellToString, parseXlsxToRows } from './xlsx';

/**
 * XLSX parsing for staged imports: a real workbook is built in-memory with
 * exceljs and round-tripped through the parser, proving CSV-equivalent rows
 * (string values, dates as YYYY-MM-DD, formulas by result, empty rows
 * skipped) and the VALIDATION_ERROR envelope for garbage files.
 */

async function buildXlsx(
  rows: unknown[][],
  sheetName = 'Sheet1',
): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) {
    sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function expectValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(400);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    'VALIDATION_ERROR',
  );
}

describe('parseXlsxToRows', () => {
  it('maps header + data rows to CSV-equivalent string records', async () => {
    const buffer = await buildXlsx([
      ['employee_number', 'first_name', 'last_name', 'start_date'],
      ['EMP-001', 'Juan', 'Dela Cruz', new Date(Date.UTC(2026, 0, 15))],
      [' EMP-002 ', 'Maria', 'Santos', ''],
    ]);
    const rows = await parseXlsxToRows(buffer);
    expect(rows).toEqual([
      {
        employee_number: 'EMP-001',
        first_name: 'Juan',
        last_name: 'Dela Cruz',
        start_date: '2026-01-15',
      },
      {
        employee_number: 'EMP-002',
        first_name: 'Maria',
        last_name: 'Santos',
        start_date: '',
      },
    ]);
  });

  it('stringifies numbers without locale formatting (item costs)', async () => {
    const buffer = await buildXlsx([
      ['sku', 'standard_cost'],
      ['SKU-1', 1500.5],
    ]);
    const rows = await parseXlsxToRows(buffer);
    expect(rows[0].standard_cost).toBe('1500.5');
  });

  it('skips fully empty rows instead of producing blank records', async () => {
    const buffer = await buildXlsx([
      ['code', 'name'],
      ['A', 'Alpha'],
      ['', ''],
      ['B', 'Beta'],
    ]);
    const rows = await parseXlsxToRows(buffer);
    expect(rows.map((row) => row.code)).toEqual(['A', 'B']);
  });

  it('rejects a non-XLSX buffer with the VALIDATION_ERROR envelope', async () => {
    let caught: unknown = null;
    try {
      await parseXlsxToRows(Buffer.from('this,is,csv\n1,2,3\n'));
    } catch (error) {
      caught = error;
    }
    expectValidationError(caught);
  });

  it('rejects a workbook whose first row has no headers', async () => {
    const buffer = await buildXlsx([]);
    let caught: unknown = null;
    try {
      await parseXlsxToRows(buffer);
    } catch (error) {
      caught = error;
    }
    expectValidationError(caught);
  });
});

describe('cellToString', () => {
  it('normalizes the exceljs cell value zoo', () => {
    expect(cellToString(null)).toBe('');
    expect(cellToString(undefined)).toBe('');
    expect(cellToString('  text  ')).toBe('text');
    expect(cellToString(42)).toBe('42');
    expect(cellToString(true)).toBe('true');
    expect(cellToString(new Date(Date.UTC(2026, 7, 5)))).toBe('2026-08-05');
    expect(
      cellToString({ richText: [{ text: 'Bold' }, { text: ' part' }] }),
    ).toBe('Bold part');
    expect(
      cellToString({ formula: 'A1*2', result: 84 } as never),
    ).toBe('84');
    expect(
      cellToString({ text: 'GemCor', hyperlink: 'https://x' } as never),
    ).toBe('GemCor');
    expect(cellToString({ error: '#REF!' } as never)).toBe('');
  });
});
