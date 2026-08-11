/**
 * Pure pdfkit layout engine for the six Phase 7 printable documents
 * (api-outline §8): GemCor header band, document number, two-column field
 * grid, ruled line table with repeated headers across page breaks, notes,
 * and signature blocks. Built-in Helvetica only — no font assets.
 */
import PDFDocument from 'pdfkit';

export interface DocField {
  label: string;
  value: string | null;
}

export interface DocTableColumn {
  header: string;
  /** Relative width (default 1). */
  width?: number;
  align?: 'left' | 'right';
}

export interface DocSignature {
  /** Line under the signature, e.g. "Received by (Custodian)". */
  role: string;
  /** Pre-printed name over the line (optional). */
  name?: string | null;
}

export interface DocTable {
  caption?: string;
  columns: DocTableColumn[];
  rows: Array<Array<string | null>>;
  /** Summary lines rendered right-aligned under the table (label, value). */
  totals?: Array<[string, string]>;
}

export interface PrintableDocumentSpec {
  /** Document form name, e.g. "PURCHASE ORDER". */
  title: string;
  /** Business number, e.g. "PO-2026-00042". */
  documentNumber: string;
  /** Status / context line under the number. */
  subtitle?: string;
  /** Groups of label/value fields laid out two per row. */
  fieldGroups: DocField[][];
  tables?: DocTable[];
  notes?: string | null;
  signatures?: DocSignature[];
}

const MARGIN = 46;
const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const ROW_HEIGHT = 17;
const HEADER_HEIGHT = 19;
const CELL_PAD = 4;

export async function renderPrintableDocument(
  spec: PrintableDocumentSpec,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: {
      Title: `${spec.title} ${spec.documentNumber}`,
      Author: 'GEM ERP — GemCor',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const contentWidth = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN;
  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bottom()) {
      doc.addPage();
      doc.y = MARGIN;
    }
  };

  // --- Header band --------------------------------------------------------
  doc
    .font(FONT_BOLD)
    .fontSize(18)
    .fillColor('#111111')
    .text('GemCor', MARGIN, MARGIN);
  doc
    .font(FONT)
    .fontSize(8)
    .fillColor('#666666')
    .text('GEM ERP — Asset & Inventory Management', MARGIN, doc.y + 1);
  doc
    .font(FONT_BOLD)
    .fontSize(14)
    .fillColor('#111111')
    .text(spec.title, MARGIN, MARGIN, { width: contentWidth, align: 'right' });
  doc
    .font(FONT_BOLD)
    .fontSize(11)
    .fillColor('#333333')
    .text(spec.documentNumber, MARGIN, doc.y + 2, {
      width: contentWidth,
      align: 'right',
    });
  if (spec.subtitle) {
    doc
      .font(FONT)
      .fontSize(9)
      .fillColor('#666666')
      .text(spec.subtitle, MARGIN, doc.y + 2, {
        width: contentWidth,
        align: 'right',
      });
  }
  doc.y = Math.max(doc.y, MARGIN + 46) + 8;
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(doc.page.width - MARGIN, doc.y)
    .lineWidth(1)
    .strokeColor('#222222')
    .stroke();
  doc.y += 12;

  // --- Field grid (two fields per row) ------------------------------------
  const colWidth = contentWidth / 2;
  for (const group of spec.fieldGroups) {
    for (let index = 0; index < group.length; index += 2) {
      ensureSpace(30);
      const rowY = doc.y;
      const pair = [group[index], group[index + 1]].filter(
        (field): field is DocField => field !== undefined,
      );
      pair.forEach((field, pairIndex) => {
        const x = MARGIN + pairIndex * colWidth;
        doc
          .font(FONT)
          .fontSize(7.5)
          .fillColor('#777777')
          .text(field.label.toUpperCase(), x, rowY, { width: colWidth - 12 });
        doc
          .font(FONT_BOLD)
          .fontSize(9.5)
          .fillColor('#111111')
          .text(field.value ?? '—', x, rowY + 10, { width: colWidth - 12 });
      });
      doc.y = rowY + 28;
    }
    doc.y += 4;
  }

  // --- Line tables ---------------------------------------------------------
  for (const table of spec.tables ?? []) {
    const { columns, rows, caption, totals } = table;
    const totalWeight = columns.reduce((sum, col) => sum + (col.width ?? 1), 0);
    const widths = columns.map(
      (col) => ((col.width ?? 1) / totalWeight) * contentWidth,
    );

    if (caption) {
      ensureSpace(24);
      doc
        .font(FONT_BOLD)
        .fontSize(10)
        .fillColor('#111111')
        .text(caption, MARGIN, doc.y);
      doc.y += 4;
    }

    const drawTableHeader = () => {
      const y = doc.y;
      doc
        .rect(MARGIN, y, contentWidth, HEADER_HEIGHT)
        .fillColor('#efefef')
        .fill();
      let x = MARGIN;
      doc.font(FONT_BOLD).fontSize(8).fillColor('#111111');
      columns.forEach((column, i) => {
        doc.text(column.header, x + CELL_PAD, y + 5, {
          width: widths[i] - CELL_PAD * 2,
          align: column.align ?? 'left',
          ellipsis: true,
          lineBreak: false,
        });
        x += widths[i];
      });
      doc.y = y + HEADER_HEIGHT;
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(doc.page.width - MARGIN, doc.y)
        .lineWidth(0.6)
        .strokeColor('#999999')
        .stroke();
      doc.y += 1;
    };

    ensureSpace(HEADER_HEIGHT + ROW_HEIGHT);
    drawTableHeader();
    doc.font(FONT).fontSize(8);
    for (const row of rows) {
      if (doc.y + ROW_HEIGHT > bottom()) {
        doc.addPage();
        doc.y = MARGIN;
        drawTableHeader();
        doc.font(FONT).fontSize(8);
      }
      const y = doc.y;
      let x = MARGIN;
      doc.fillColor('#222222');
      columns.forEach((column, i) => {
        doc.text(row[i] ?? '', x + CELL_PAD, y + 4, {
          width: widths[i] - CELL_PAD * 2,
          align: column.align ?? 'left',
          ellipsis: true,
          lineBreak: false,
        });
        x += widths[i];
      });
      doc.y = y + ROW_HEIGHT;
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(doc.page.width - MARGIN, doc.y)
        .lineWidth(0.3)
        .strokeColor('#dddddd')
        .stroke();
      doc.y += 1;
    }
    if (rows.length === 0) {
      ensureSpace(ROW_HEIGHT);
      doc
        .font(FONT)
        .fontSize(8.5)
        .fillColor('#777777')
        .text('No lines.', MARGIN + CELL_PAD, doc.y + 4);
      doc.y += ROW_HEIGHT;
    }
    if (totals && totals.length > 0) {
      doc.y += 4;
      for (const [label, value] of totals) {
        ensureSpace(14);
        const y = doc.y;
        doc
          .font(FONT)
          .fontSize(8.5)
          .fillColor('#555555')
          .text(label, MARGIN, y, {
            width: contentWidth - 110,
            align: 'right',
          });
        doc
          .font(FONT_BOLD)
          .fontSize(8.5)
          .fillColor('#111111')
          .text(value, doc.page.width - MARGIN - 100, y, {
            width: 100,
            align: 'right',
          });
        doc.y = y + 13;
      }
    }
    doc.y += 6;
  }

  // --- Notes ---------------------------------------------------------------
  if (spec.notes) {
    ensureSpace(40);
    doc.font(FONT).fontSize(7.5).fillColor('#777777').text('NOTES', MARGIN, doc.y);
    doc
      .font(FONT)
      .fontSize(9)
      .fillColor('#222222')
      .text(spec.notes, MARGIN, doc.y + 2, { width: contentWidth });
    doc.y += 8;
  }

  // --- Signature blocks ----------------------------------------------------
  if (spec.signatures && spec.signatures.length > 0) {
    const blockWidth = Math.min(
      220,
      (contentWidth - 24 * (spec.signatures.length - 1)) / spec.signatures.length,
    );
    ensureSpace(84);
    doc.y += 26;
    const y = doc.y;
    spec.signatures.forEach((signature, index) => {
      const x = MARGIN + index * (blockWidth + 24);
      if (signature.name) {
        doc
          .font(FONT_BOLD)
          .fontSize(9)
          .fillColor('#111111')
          .text(signature.name, x, y + 14, {
            width: blockWidth,
            align: 'center',
            ellipsis: true,
            lineBreak: false,
          });
      }
      doc
        .moveTo(x, y + 30)
        .lineTo(x + blockWidth, y + 30)
        .lineWidth(0.8)
        .strokeColor('#333333')
        .stroke();
      doc
        .font(FONT)
        .fontSize(8)
        .fillColor('#555555')
        .text(signature.role, x, y + 34, { width: blockWidth, align: 'center' });
      doc
        .font(FONT)
        .fontSize(7)
        .fillColor('#999999')
        .text('Signature over printed name / date', x, y + 46, {
          width: blockWidth,
          align: 'center',
        });
    });
    doc.y = y + 62;
  }

  // --- Footer --------------------------------------------------------------
  doc
    .font(FONT)
    .fontSize(7)
    .fillColor('#999999')
    .text(
      `Generated by GEM ERP ${new Date().toISOString()} (UTC) — GemCor internal document`,
      MARGIN,
      Math.min(doc.y + 10, bottom() - 10),
      { width: contentWidth },
    );

  doc.end();
  return done;
}
