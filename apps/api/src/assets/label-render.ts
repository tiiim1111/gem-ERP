import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import type { LabelSize } from './dto/label.dto';

/**
 * Pure label rendering (docs/barcode-strategy.md §2.2, §8).
 *
 * Every asset label carries:
 *  1. Code 128 encoding the asset tag literally (operator wedge scans),
 *  2. a QR encoding ONLY the opaque scan URL {WEB_ORIGIN}/scan/{token} —
 *     never any record data,
 *  3. human-readable text: tag, item name (truncated), "Property of GemCor".
 *
 * SVG output is the print-fidelity path; PNG is a raster fallback composed
 * with pngjs (pure JS — no native canvas), using a built-in 5×7 bitmap font
 * for the text lines.
 */

export interface LabelData {
  assetTag: string;
  itemName: string;
  /** {WEB_ORIGIN}/scan/{token} — the only thing the QR ever encodes. */
  scanUrl: string;
  /** Ownership line; defaults to {@link DEFAULT_PROPERTY_LINE}. */
  propertyLine?: string;
}

/**
 * Fallback only. Callers pass the organisation's own name so renaming the
 * company does not mean editing code — see LabelService.
 */
export const DEFAULT_PROPERTY_LINE = 'Property of GemCor';

/** Ownership line for a label, falling back when none was supplied. */
export function propertyLineOf(data: LabelData): string {
  return data.propertyLine?.trim() || DEFAULT_PROPERTY_LINE;
}

export function buildScanUrl(webOrigin: string, scanToken: string): string {
  return `${webOrigin.replace(/\/+$/, '')}/scan/${scanToken}`;
}

interface SizeSpec {
  width: number;
  height: number;
  qr: { x: number; y: number; size: number };
  code128: { x: number; y: number; width: number; height: number };
  text: {
    x: number;
    /** Tag line; the other blocks are placed relative to it. */
    tagY: number;
    tagPx: number;
    bodyPx: number;
    /** Tag baseline → first body line. */
    headGap: number;
    /** Between wrapped lines inside one block. */
    lineStep: number;
    /** Last line of a block → first line of the next. */
    blockGap: number;
    /**
     * Characters per line. Budgeted against the PNG's fixed-width bitmap
     * font, which is wider than the SVG's proportional one — so a line that
     * fits the PNG fits the SVG too.
     */
    maxChars: number;
    /** Wrapped lines allowed per block before the text is cut. */
    maxLines: number;
  };
}

/** 300-dpi pixel geometry for the two thermal presets. */
const SIZE_SPECS: Record<LabelSize, SizeSpec> = {
  // 50.8 × 25.4 mm (2" × 1")
  // Both columns share the band y 60–240, centred in the 300-tall stock: the
  // QR and the barcode start together and the last text line ends level with
  // the QR's foot, so a printed sheet reads as two tidy columns.
  '2x1': {
    width: 600,
    height: 300,
    qr: { x: 20, y: 60, size: 180 },
    code128: { x: 220, y: 60, width: 360, height: 48 },
    text: {
      x: 220,
      tagY: 138,
      tagPx: 24,
      bodyPx: 22,
      headGap: 34,
      lineStep: 28,
      blockGap: 34,
      maxChars: 30,
      maxLines: 2,
    },
  },
  // 76.2 × 50.8 mm (3" × 2")
  // Same idea at 3" × 2": the shared band is y 150–450.
  '3x2': {
    width: 900,
    height: 600,
    qr: { x: 40, y: 150, size: 300 },
    code128: { x: 380, y: 150, width: 480, height: 80 },
    text: {
      x: 380,
      tagY: 268,
      tagPx: 34,
      bodyPx: 30,
      headGap: 58,
      lineStep: 48,
      blockGap: 58,
      maxChars: 27,
      maxLines: 2,
    },
  },
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Greedy word wrap into at most `maxLines`. Anything that still does not fit
 * is cut with an ellipsis on the last line — a label that overflows its stock
 * prints the overhanging text onto nothing, so cutting is the safe failure.
 */
function wrapLines(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [''];
  }
  const lines: string[] = [];
  let current = '';
  let dropped = false;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (lines.length + 1 >= maxLines) {
      // The line in hand is the last one; the rest cannot be shown.
      dropped = true;
      break;
    }
    if (current) {
      lines.push(current);
    }
    // A single word wider than the line still has to start somewhere.
    current = word.length > maxChars ? truncate(word, maxChars) : word;
  }
  if (current) {
    lines.push(current);
  }
  if (dropped) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines.slice(0, maxLines);
}

interface TextLine {
  text: string;
  y: number;
  px: number;
  mono: boolean;
}

/**
 * Lays the three blocks out top-down so a wrapped item name pushes the
 * ownership line down instead of printing over it.
 */
function layoutText(data: LabelData, spec: SizeSpec): TextLine[] {
  const { text } = spec;
  const lines: TextLine[] = [
    { text: data.assetTag, y: text.tagY, px: text.tagPx, mono: true },
  ];

  let y = text.tagY + text.headGap;
  for (const block of [
    wrapLines(data.itemName, text.maxChars, text.maxLines),
    wrapLines(propertyLineOf(data), text.maxChars, text.maxLines),
  ]) {
    block.forEach((line, index) => {
      lines.push({ text: line, y: y + index * text.lineStep, px: text.bodyPx, mono: false });
    });
    y += (block.length - 1) * text.lineStep + text.blockGap;
  }
  return lines;
}

/** Re-position a standalone SVG document as a nested element. */
function embedSvg(
  svg: string,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const open = /<svg\b([^>]*)>/.exec(svg);
  if (!open) {
    return svg;
  }
  const attrs = open[1].replace(/\s(?:width|height|x|y)="[^"]*"/g, '');
  return svg.replace(
    open[0],
    `<svg${attrs} x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">`,
  );
}

/** Composed SVG label (default format). */
export async function renderLabelSvg(
  data: LabelData,
  size: LabelSize,
): Promise<string> {
  const spec = SIZE_SPECS[size];
  const qrSvg = await QRCode.toString(data.scanUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
  });
  const code128Svg = bwipjs.toSVG({
    bcid: 'code128',
    text: data.assetTag,
    height: 10,
    includetext: false,
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="${spec.width}" height="${spec.height}">`,
    `<rect width="${spec.width}" height="${spec.height}" fill="#ffffff"/>`,
    embedSvg(qrSvg, spec.qr.x, spec.qr.y, spec.qr.size, spec.qr.size),
    embedSvg(
      code128Svg,
      spec.code128.x,
      spec.code128.y,
      spec.code128.width,
      spec.code128.height,
    ),
    ...layoutText(data, spec).map((line) =>
      line.mono
        ? `<text x="${spec.text.x}" y="${line.y}" font-family="monospace" font-size="${line.px}" font-weight="bold" fill="#000">${escapeXml(line.text)}</text>`
        : `<text x="${spec.text.x}" y="${line.y}" font-family="sans-serif" font-size="${line.px}" fill="#000">${escapeXml(line.text)}</text>`,
    ),
    '</svg>',
  ].join('\n');
}

/** Printable batch sheet: one HTML page of SVG labels with print CSS. */
export function renderBatchHtml(labels: string[], size: LabelSize): string {
  const spec = SIZE_SPECS[size];
  const cells = labels
    .map((svg) => `<div class="label">${svg}</div>`)
    .join('\n');
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"/>',
    '<title>GEM-ENI asset labels</title>',
    '<style>',
    'body{margin:0;padding:8px;background:#f2f2f2;font-family:sans-serif;}',
    `.label{width:${spec.width / 2}px;height:${spec.height / 2}px;background:#fff;` +
      'display:inline-block;margin:4px;border:1px dashed #bbb;overflow:hidden;}',
    '.label svg{width:100%;height:100%;}',
    '@media print{body{background:#fff;padding:0;}.label{border:none;margin:0;page-break-inside:avoid;}}',
    '</style></head><body>',
    cells,
    '</body></html>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// PNG composition (pure JS): pngjs blitting + built-in 5×7 bitmap font
// ---------------------------------------------------------------------------

/**
 * Minimal 5×7 bitmap font (uppercase, digits, common punctuation). "#" marks
 * a lit pixel. Lowercase input is uppercased; unknown characters render as
 * spaces. Good enough for thermal-label text; the SVG path carries the
 * typographic rendering.
 */
const FONT_5X7: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
};

function setPixel(png: PNG, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }
  const idx = (png.width * y + x) * 4;
  png.data[idx] = 0;
  png.data[idx + 1] = 0;
  png.data[idx + 2] = 0;
  png.data[idx + 3] = 255;
}

/** Draw `text` at (x, y) with the 5×7 font scaled by `scale`. */
function drawText(
  png: PNG,
  text: string,
  x: number,
  y: number,
  scale: number,
): void {
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = FONT_5X7[raw] ?? FONT_5X7[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (glyph[row][col] !== '#') {
          continue;
        }
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            setPixel(png, cursor + col * scale + dx, y + row * scale + dy);
          }
        }
      }
    }
    cursor += 6 * scale; // 5px glyph + 1px spacing
  }
}

/** Copy `src` into `dest` at (dx, dy), clipping at the canvas edge. */
function blit(dest: PNG, src: PNG, dx: number, dy: number): void {
  const width = Math.min(src.width, dest.width - dx);
  const height = Math.min(src.height, dest.height - dy);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (src.width * y + x) * 4;
      const to = (dest.width * (dy + y) + (dx + x)) * 4;
      dest.data[to] = src.data[from];
      dest.data[to + 1] = src.data[from + 1];
      dest.data[to + 2] = src.data[from + 2];
      dest.data[to + 3] = 255;
    }
  }
}

/** Raster label (format=png), composed without native dependencies. */
export async function renderLabelPng(
  data: LabelData,
  size: LabelSize,
): Promise<Buffer> {
  const spec = SIZE_SPECS[size];
  const canvas = new PNG({ width: spec.width, height: spec.height });
  canvas.data.fill(255);

  const qrPng = PNG.sync.read(
    await QRCode.toBuffer(data.scanUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: spec.qr.size,
    }),
  );
  blit(canvas, qrPng, spec.qr.x, spec.qr.y);

  const scale = size === '2x1' ? 1 : 2;
  const code128Png = PNG.sync.read(
    await bwipjs.toBuffer({
      bcid: 'code128',
      text: data.assetTag,
      height: 8 * scale,
      scale,
      includetext: false,
    }),
  );
  blit(canvas, code128Png, spec.code128.x, spec.code128.y);

  const textScale = size === '2x1' ? 2 : 3;
  for (const line of layoutText(data, spec)) {
    drawText(canvas, line.text, spec.text.x, line.y, textScale);
  }

  return PNG.sync.write(canvas);
}
