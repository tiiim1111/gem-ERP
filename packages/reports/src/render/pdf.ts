/**
 * PDF report-table renderer (pdfkit, built-in Helvetica — no font assets).
 * Landscape A4, GemCor header band, repeated column headers per page, and a
 * truncation notice when the export hit the row cap.
 */
import PDFDocument from 'pdfkit';
import type { ReportCellValue, ReportColumn, ReportRow } from '../types';

export interface PdfRenderOptions {
  title: string;
  /** Optional filter summary line under the title. */
  subtitle?: string;
  /** Row-cap notice appended after the table. */
  truncatedNote?: string;
}

const PAGE_MARGIN = 36;
const HEADER_HEIGHT = 18;
const ROW_HEIGHT = 15;
const CELL_PAD = 3;
const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

function cellText(value: ReportCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

export async function renderPdfTable(
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  includeCost: boolean,
  options: PdfRenderOptions,
): Promise<Buffer> {
  const visible = columns.filter((column) => !column.cost || includeCost);
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: PAGE_MARGIN,
    info: { Title: options.title, Author: 'GEM ERP — GemCor' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const tableWidth = doc.page.width - PAGE_MARGIN * 2;
  const totalWeight = visible.reduce((sum, col) => sum + (col.width ?? 1), 0);
  const widths = visible.map(
    (col) => ((col.width ?? 1) / totalWeight) * tableWidth,
  );
  const bottom = () => doc.page.height - PAGE_MARGIN;

  const drawDocumentHeader = () => {
    doc
      .font(FONT_BOLD)
      .fontSize(16)
      .fillColor('#111111')
      .text('GemCor', PAGE_MARGIN, PAGE_MARGIN, { continued: true })
      .font(FONT)
      .fillColor('#555555')
      .text('  ·  GEM ERP');
    doc
      .font(FONT_BOLD)
      .fontSize(12)
      .fillColor('#111111')
      .text(options.title, PAGE_MARGIN, doc.y + 4);
    const meta = [
      options.subtitle,
      `Generated ${new Date().toISOString()} (UTC)`,
    ]
      .filter(Boolean)
      .join('  ·  ');
    doc.font(FONT).fontSize(8).fillColor('#666666').text(meta, PAGE_MARGIN, doc.y + 2);
    doc
      .moveTo(PAGE_MARGIN, doc.y + 6)
      .lineTo(doc.page.width - PAGE_MARGIN, doc.y + 6)
      .lineWidth(0.8)
      .strokeColor('#333333')
      .stroke();
    doc.y += 12;
  };

  const drawTableHeader = () => {
    const y = doc.y;
    doc
      .rect(PAGE_MARGIN, y, tableWidth, HEADER_HEIGHT)
      .fillColor('#eeeeee')
      .fill();
    let x = PAGE_MARGIN;
    doc.font(FONT_BOLD).fontSize(7).fillColor('#111111');
    visible.forEach((column, index) => {
      doc.text(column.header, x + CELL_PAD, y + 5, {
        width: widths[index] - CELL_PAD * 2,
        height: HEADER_HEIGHT,
        ellipsis: true,
        lineBreak: false,
      });
      x += widths[index];
    });
    doc.y = y + HEADER_HEIGHT + 2;
  };

  drawDocumentHeader();
  drawTableHeader();

  doc.font(FONT).fontSize(7);
  rows.forEach((row, rowIndex) => {
    if (doc.y + ROW_HEIGHT > bottom()) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
      drawTableHeader();
      doc.font(FONT).fontSize(7);
    }
    const y = doc.y;
    if (rowIndex % 2 === 1) {
      doc.rect(PAGE_MARGIN, y - 1, tableWidth, ROW_HEIGHT).fillColor('#f7f7f7').fill();
    }
    let x = PAGE_MARGIN;
    doc.fillColor('#222222');
    visible.forEach((column, index) => {
      doc.text(cellText(row[column.key] ?? null), x + CELL_PAD, y + 3, {
        width: widths[index] - CELL_PAD * 2,
        height: ROW_HEIGHT,
        ellipsis: true,
        lineBreak: false,
      });
      x += widths[index];
    });
    doc.y = y + ROW_HEIGHT;
  });

  if (rows.length === 0) {
    doc
      .font(FONT)
      .fontSize(9)
      .fillColor('#666666')
      .text('No rows matched the report filters.', PAGE_MARGIN, doc.y + 8);
  }
  if (options.truncatedNote) {
    doc
      .font(FONT_BOLD)
      .fontSize(8)
      .fillColor('#993333')
      .text(options.truncatedNote, PAGE_MARGIN, doc.y + 10);
  }

  doc.end();
  return done;
}
