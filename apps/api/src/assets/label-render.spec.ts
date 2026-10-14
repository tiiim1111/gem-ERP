import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import {
  buildScanUrl,
  DEFAULT_PROPERTY_LINE,
  renderBatchHtml,
  renderLabelPng,
  renderLabelSvg,
} from './label-render';

/**
 * Label content sanity (docs/barcode-strategy.md §2.2):
 * - the Code 128 encodes the asset tag literally,
 * - the QR encodes ONLY the opaque scan URL — no tag, serial, or record data,
 * - tag / item name / "Property of GemCor" appear as human-readable text.
 *
 * The symbology libraries are mocked so the tests assert exactly WHAT gets
 * encoded, not how the vendors rasterize it.
 */

jest.mock('qrcode', () => ({
  toString: jest.fn(),
  toBuffer: jest.fn(),
}));
jest.mock('bwip-js', () => ({
  toSVG: jest.fn(),
  toBuffer: jest.fn(),
}));

const qrToString = QRCode.toString as unknown as jest.Mock;
const qrToBuffer = QRCode.toBuffer as unknown as jest.Mock;
const bwipToSVG = bwipjs.toSVG as unknown as jest.Mock;
const bwipToBuffer = bwipjs.toBuffer as unknown as jest.Mock;

const TOKEN = 'OPAQUE_TOKEN_abcdef1234567890abcdef12345';
const DATA = {
  assetTag: 'AST-SUB-LAP-2026-000123',
  itemName: 'Dell Latitude 5450 14" Laptop',
  scanUrl: buildScanUrl('http://localhost:3000', TOKEN),
};

function tinyPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(200);
  return PNG.sync.write(png);
}

beforeEach(() => {
  jest.clearAllMocks();
  qrToString.mockResolvedValue('<svg viewBox="0 0 33 33"><path d="M0 0"/></svg>');
  qrToBuffer.mockResolvedValue(tinyPng(64, 64));
  bwipToSVG.mockReturnValue('<svg viewBox="0 0 200 60"><g/></svg>');
  bwipToBuffer.mockResolvedValue(tinyPng(120, 40));
});

/** Visible text of each <text> element, in document order. */
function textLines(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) =>
    match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
  );
}

/** x/y/width/height of each nested <svg> (the QR, then the barcode). */
function embeddedBoxes(svg: string): Array<{ y: number; height: number }> {
  return [...svg.matchAll(/<svg\b(?![^>]*viewBox="0 0 \d+ \d+" width)[^>]*\by="(\d+)"[^>]*\bheight="(\d+)"/g)].map(
    (match) => ({ y: Number(match[1]), height: Number(match[2]) }),
  );
}

/** Baseline y of each <text> element. */
function textYs(svg: string): number[] {
  return [...svg.matchAll(/<text[^>]*\by="(\d+)"/g)].map((match) => Number(match[1]));
}

describe('buildScanUrl', () => {
  it('is origin + /scan/ + token and nothing else (no record data)', () => {
    expect(buildScanUrl('http://localhost:3000', 'tok')).toBe(
      'http://localhost:3000/scan/tok',
    );
    expect(buildScanUrl('https://gemerp.example/', 'tok')).toBe(
      'https://gemerp.example/scan/tok',
    );
  });
});

describe('renderLabelSvg', () => {
  it('encodes the asset tag in Code 128 and the opaque URL in the QR', async () => {
    await renderLabelSvg(DATA, '2x1');

    expect(bwipToSVG).toHaveBeenCalledWith(
      expect.objectContaining({ bcid: 'code128', text: DATA.assetTag }),
    );
    expect(qrToString).toHaveBeenCalledTimes(1);
    const [qrPayload, qrOpts] = qrToString.mock.calls[0];
    expect(qrPayload).toBe(`http://localhost:3000/scan/${TOKEN}`);
    expect(qrOpts).toEqual(
      expect.objectContaining({ type: 'svg', errorCorrectionLevel: 'M' }),
    );
    // The QR payload never contains the tag, serial, or any record data.
    expect(qrPayload).not.toContain(DATA.assetTag);
    expect(qrPayload).not.toContain('Dell');
  });

  it('carries the human-readable lines: tag, item name, ownership line', async () => {
    const svg = await renderLabelSvg(DATA, '2x1');
    expect(svg).toContain(DATA.assetTag);
    expect(svg).toContain(DEFAULT_PROPERTY_LINE);
    // Fits one line within the budget, XML-escaped (the name has a quote).
    expect(svg).toContain('Dell Latitude 5450 14&quot; Laptop');
    // The raw scan token/URL never appears as visible label text.
    expect(svg).not.toContain(TOKEN);
  });

  // The company name comes from the organisation record, so renaming it must
  // reprint correctly without a code change.
  it('prints the supplied ownership line instead of the fallback', async () => {
    const svg = await renderLabelSvg(
      { ...DATA, propertyLine: 'Property of GEM Investment Corp.' },
      '2x1',
    );
    // Too wide for one line, so it wraps rather than running off the stock.
    expect(textLines(svg)).toEqual(
      expect.arrayContaining(['Property of GEM Investment', 'Corp.']),
    );
    expect(svg).not.toContain(DEFAULT_PROPERTY_LINE);
  });

  it('wraps a long item name instead of overflowing the label', async () => {
    const svg = await renderLabelSvg(
      { ...DATA, itemName: 'Executive Swivel Chair with Adjustable Lumbar Support' },
      '2x1',
    );
    expect(textLines(svg)).toEqual(
      expect.arrayContaining(['Executive Swivel Chair with', 'Adjustable Lumbar Support']),
    );
  });

  it('cuts with an ellipsis once both lines are used up', async () => {
    const svg = await renderLabelSvg(
      {
        ...DATA,
        itemName: 'Executive Swivel Chair with Adjustable Lumbar Support and Chrome Base',
      },
      '2x1',
    );
    expect(textLines(svg).some((line) => line.endsWith('…'))).toBe(true);
  });

  // Overflowing text prints onto nothing, so every line must stay inside the
  // character budget both renderers share.
  it('keeps every line within the width budget', async () => {
    const svg = await renderLabelSvg(
      {
        ...DATA,
        itemName: 'Executive Swivel Chair with Adjustable Lumbar Support',
        propertyLine: 'Property of GEM Investment Corporation Philippines',
      },
      '2x1',
    );
    for (const line of textLines(svg)) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });

  it('pushes the ownership line down when the item name wraps', async () => {
    const oneLine = textYs(await renderLabelSvg(DATA, '2x1'));
    const twoLines = textYs(
      await renderLabelSvg(
        { ...DATA, itemName: 'Executive Swivel Chair with Adjustable Support' },
        '2x1',
      ),
    );
    // A wrapped name adds a line, so the block after it starts lower.
    expect(twoLines.length).toBeGreaterThan(oneLine.length);
    expect(Math.max(...twoLines)).toBeGreaterThan(Math.max(...oneLine));
  });

  // A printed sheet reads as two ragged columns unless the QR and the text
  // block occupy the same vertical band.
  it.each(['2x1', '3x2'] as const)('aligns both columns top and bottom (%s)', async (size) => {
    const svg = await renderLabelSvg(
      { ...DATA, itemName: 'Staff Chair', propertyLine: 'Property of GEM Investment Corp.' },
      size,
    );
    const [qr, barcode] = embeddedBoxes(svg);
    // Top to top: the barcode starts level with the QR.
    expect(barcode.y).toBe(qr.y);
    // Bottom to bottom: the last line lands on the QR's foot, within the
    // descender of one line.
    const lastBaseline = Math.max(...textYs(svg));
    expect(lastBaseline).toBeLessThanOrEqual(qr.y + qr.height);
    expect(lastBaseline).toBeGreaterThan(qr.y + qr.height - 24);
  });

  it('falls back when the ownership line is blank', async () => {
    const svg = await renderLabelSvg({ ...DATA, propertyLine: '   ' }, '2x1');
    expect(svg).toContain(DEFAULT_PROPERTY_LINE);
  });

  it('supports both size presets', async () => {
    const small = await renderLabelSvg(DATA, '2x1');
    const large = await renderLabelSvg(DATA, '3x2');
    expect(small).toContain('viewBox="0 0 600 300"');
    expect(large).toContain('viewBox="0 0 900 600"');
  });
});

describe('renderLabelPng', () => {
  it('produces a valid PNG with both symbologies composed in', async () => {
    const buffer = await renderLabelPng(DATA, '2x1');
    // PNG signature.
    expect([...buffer.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    const decoded = PNG.sync.read(buffer);
    expect(decoded.width).toBe(600);
    expect(decoded.height).toBe(300);
    expect(qrToBuffer).toHaveBeenCalledWith(
      DATA.scanUrl,
      expect.objectContaining({ errorCorrectionLevel: 'M' }),
    );
    expect(bwipToBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ bcid: 'code128', text: DATA.assetTag }),
    );
  });
});

describe('renderBatchHtml', () => {
  it('wraps every label in a printable sheet', () => {
    const html = renderBatchHtml(['<svg>one</svg>', '<svg>two</svg>'], '2x1');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<svg>one</svg>');
    expect(html).toContain('<svg>two</svg>');
    expect(html).toContain('@media print');
  });
});
