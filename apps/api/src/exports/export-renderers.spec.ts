import ExcelJS from 'exceljs';
import type { ReportColumn, ReportRow } from '@gemerp/reports';
import {
  exportFileName,
  renderCsv,
  renderExport,
  renderXlsx,
  getReportDefinition,
} from '@gemerp/reports';

/**
 * Render snapshots against fixed fixture rows (implementation plan Phase 7
 * verification). CSV is byte-exact; XLSX is round-tripped through exceljs;
 * PDF is checked for structure (magic bytes + non-trivial body).
 */

const columns: ReportColumn[] = [
  { key: 'sku', header: 'SKU' },
  { key: 'name', header: 'Item name' },
  { key: 'qty', header: 'Qty' },
  { key: 'active', header: 'Active' },
  { key: 'unitCost', header: 'Unit cost', cost: true },
];

const rows: ReportRow[] = [
  { sku: 'SKU-PPR-00017', name: 'Bond paper, "A4"', qty: '10', active: true, unitCost: '250.00' },
  { sku: 'SKU-INK-00003', name: 'Ink, black\nrefill', qty: '3', active: false, unitCost: '899.50' },
  { sku: 'SKU-CBL-00009', name: 'Cable, HDMI 2m', qty: '0', active: true, unitCost: null },
];

describe('CSV renderer', () => {
  it('is byte-exact: RFC 4180 quoting, CRLF endings, cost column included', () => {
    const csv = renderCsv(columns, rows, true);
    expect(csv).toBe(
      'SKU,Item name,Qty,Active,Unit cost\r\n' +
        'SKU-PPR-00017,"Bond paper, ""A4""",10,true,250.00\r\n' +
        'SKU-INK-00003,"Ink, black\nrefill",3,false,899.50\r\n' +
        'SKU-CBL-00009,"Cable, HDMI 2m",0,true,\r\n',
    );
  });

  it('drops cost columns without includeCost', () => {
    const csv = renderCsv(columns, rows, false);
    expect(csv.split('\r\n')[0]).toBe('SKU,Item name,Qty,Active');
    expect(csv).not.toContain('250.00');
  });

  it('renders a header-only file for zero rows', () => {
    expect(renderCsv(columns, [], false)).toBe('SKU,Item name,Qty,Active\r\n');
  });
});

describe('XLSX renderer', () => {
  it('round-trips headers and cell values through exceljs', async () => {
    const buffer = await renderXlsx(columns, rows, true, { title: 'Stock on hand' });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Stock on hand');
    expect(sheet).toBeDefined();
    if (!sheet) {
      throw new Error('worksheet missing');
    }
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'SKU',
      'Item name',
      'Qty',
      'Active',
      'Unit cost',
    ]);
    expect(sheet.getCell('A2').value).toBe('SKU-PPR-00017');
    expect(sheet.getCell('E2').value).toBe('250.00');
    expect(sheet.getCell('D3').value).toBe(false);
    expect(sheet.rowCount).toBe(4);
  });

  it('excludes cost columns without includeCost', async () => {
    const buffer = await renderXlsx(columns, rows, false);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).cellCount).toBe(4);
    expect(sheet.getRow(1).values).not.toContain('Unit cost');
  });
});

describe('PDF renderer (via renderExport dispatch)', () => {
  it('produces a structurally valid PDF with the truncation notice path', async () => {
    const definition = getReportDefinition('stock-on-hand');
    if (!definition) {
      throw new Error('stock-on-hand missing');
    }
    const pdfRows: ReportRow[] = Array.from({ length: 60 }, (_, i) => ({
      itemSku: `SKU-${i}`,
      itemName: `Item ${i}`,
      category: null,
      branch: 'SUB',
      warehouse: 'Subic WH',
      location: null,
      lotNumber: null,
      lotExpiry: null,
      uom: 'PC',
      onHandQty: String(i),
      reservedQty: '0',
      inTransitQty: '0',
      availableQty: String(i),
    }));
    const buffer = await renderExport({
      definition,
      rows: pdfRows,
      includeCost: false,
      format: 'pdf',
      filterSummary: 'Filters: branchId=branch-sub',
      truncated: true,
    });
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(2000);
  });

  it('dispatches csv and xlsx through the same entry point', async () => {
    const definition = getReportDefinition('low-stock');
    if (!definition) {
      throw new Error('low-stock missing');
    }
    const csv = await renderExport({
      definition,
      rows: [],
      includeCost: false,
      format: 'csv',
    });
    expect(csv.toString('utf8').startsWith('SKU,Item,Branch')).toBe(true);
    const xlsx = await renderExport({
      definition,
      rows: [],
      includeCost: false,
      format: 'xlsx',
    });
    // XLSX files are ZIP containers: PK magic.
    expect(xlsx.subarray(0, 2).toString('utf8')).toBe('PK');
  });
});

describe('export file naming', () => {
  it('stamps report key, timestamp, and extension', () => {
    const name = exportFileName('stock-on-hand', 'xlsx', new Date('2026-08-06T09:30:00.000Z'));
    expect(name).toBe('stock-on-hand-20260806-093000.xlsx');
  });
});
