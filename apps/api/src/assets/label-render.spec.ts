import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import {
  buildScanUrl,
  PROPERTY_LINE,
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

  it('carries the human-readable lines: tag, item name, Property of GemCor', async () => {
    const svg = await renderLabelSvg(DATA, '2x1');
    expect(svg).toContain(DATA.assetTag);
    expect(svg).toContain(PROPERTY_LINE);
    // Item name is truncated to the preset width and XML-escaped (the seed
    // item name contains a double quote).
    expect(svg).toContain('Dell Latitude 5450 14&quot; Lapt…');
    // The raw scan token/URL never appears as visible label text.
    expect(svg).not.toContain(TOKEN);
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
