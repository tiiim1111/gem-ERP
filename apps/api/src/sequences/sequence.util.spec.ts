import {
  formatEmployeeNumber,
  formatSequence,
  formatSku,
  skuSequenceKey,
} from './sequence.util';

describe('sequence.util', () => {
  describe('formatSequence', () => {
    it('zero-pads to the requested width', () => {
      expect(formatSequence(7, 6)).toBe('000007');
      expect(formatSequence(123, 5)).toBe('00123');
    });

    it('keeps values wider than the pad width intact', () => {
      expect(formatSequence(1234567, 6)).toBe('1234567');
    });

    it('accepts bigint counters', () => {
      expect(formatSequence(42n, 6)).toBe('000042');
    });
  });

  describe('formatEmployeeNumber', () => {
    it('produces EMP-{SEQ6}', () => {
      expect(formatEmployeeNumber(1)).toBe('EMP-000001');
      expect(formatEmployeeNumber(123)).toBe('EMP-000123');
    });
  });

  describe('formatSku', () => {
    it('produces {CATEGORY}-{SEQ5}', () => {
      expect(formatSku('PPR', 17)).toBe('PPR-00017');
      expect(formatSku('LAP', 1)).toBe('LAP-00001');
    });

    it('uppercases the category code', () => {
      expect(formatSku('lap', 2)).toBe('LAP-00002');
    });

    // Items are shared across branches; a branch code here would either lie or
    // force a duplicate catalog per branch. Branch lives in the asset tag.
    it('carries no branch segment', () => {
      expect(formatSku('LAP', 1)).not.toMatch(/MAIN|SUB|MKT/);
    });
  });

  describe('skuSequenceKey', () => {
    it('is per category so sequences never interleave across categories', () => {
      expect(skuSequenceKey('LAP')).toBe('SKU-LAP');
      expect(skuSequenceKey('ofc')).toBe('SKU-OFC');
      expect(skuSequenceKey('LAP')).not.toBe(skuSequenceKey('MON'));
    });
  });
});
