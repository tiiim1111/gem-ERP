import { conversionFactor, normalizeQuantity } from './uom-conversion.util';

const BOX = 'uom-box';
const PACK = 'uom-pack';
const PC = 'uom-pc';
const REAM = 'uom-ream';
const KG = 'uom-kg';

// 1 BOX = 10 PACK, 1 PACK = 100 PC (spec §5 example values).
const EDGES = [
  { fromUomId: BOX, toUomId: PACK, factor: 10 },
  { fromUomId: PACK, toUomId: PC, factor: 100 },
  { fromUomId: REAM, toUomId: PC, factor: 500 },
];

describe('uom-conversion.util', () => {
  describe('conversionFactor', () => {
    it('is 1 for identity conversions', () => {
      expect(conversionFactor(PC, PC, EDGES)).toBe(1);
    });

    it('resolves a direct conversion', () => {
      expect(conversionFactor(BOX, PACK, EDGES)).toBe(10);
    });

    it('resolves the inverse direction (divides by the factor)', () => {
      expect(conversionFactor(PACK, BOX, EDGES)).toBeCloseTo(0.1, 10);
      expect(conversionFactor(PC, PACK, EDGES)).toBeCloseTo(0.01, 10);
    });

    it('chains conversions: 1 BOX = 10 PACK × 100 PC = 1000 PC', () => {
      expect(conversionFactor(BOX, PC, EDGES)).toBe(1000);
    });

    it('chains through a shared unit: REAM → PC → PACK', () => {
      // 1 REAM = 500 PC, 100 PC = 1 PACK → 1 REAM = 5 PACK
      expect(conversionFactor(REAM, PACK, EDGES)).toBeCloseTo(5, 10);
    });

    it('returns null when units are not connected', () => {
      expect(conversionFactor(BOX, KG, EDGES)).toBeNull();
    });

    it('accepts Prisma-Decimal-like factors (toString objects)', () => {
      const edges = [
        { fromUomId: BOX, toUomId: PC, factor: { toString: () => '12.5' } },
      ];
      expect(conversionFactor(BOX, PC, edges)).toBe(12.5);
    });

    it('lets the first-listed edge win (item-specific overrides globals)', () => {
      const edges = [
        { fromUomId: BOX, toUomId: PC, factor: 24 }, // item-specific
        { fromUomId: BOX, toUomId: PC, factor: 12 }, // global
      ];
      expect(conversionFactor(BOX, PC, edges)).toBe(24);
    });

    it('ignores malformed factors instead of poisoning the graph', () => {
      const edges = [
        { fromUomId: BOX, toUomId: PC, factor: 0 },
        { fromUomId: BOX, toUomId: PC, factor: -5 },
        { fromUomId: BOX, toUomId: PC, factor: Number.NaN },
      ];
      expect(conversionFactor(BOX, PC, edges)).toBeNull();
    });
  });

  describe('normalizeQuantity', () => {
    it('multiplies the entered quantity by the resolved factor', () => {
      // Entering 3 BOX of an item stocked in PC → 3 × 1000 = 3000 PC.
      expect(normalizeQuantity(3, BOX, PC, EDGES)).toBe(3000);
    });

    it('normalizes across a chain in the inverse direction', () => {
      // 2500 PC entered against a BOX base unit → 2.5 BOX.
      expect(normalizeQuantity(2500, PC, BOX, EDGES)).toBeCloseTo(2.5, 10);
    });

    it('returns null when no conversion path exists', () => {
      expect(normalizeQuantity(5, BOX, KG, EDGES)).toBeNull();
    });
  });
});
