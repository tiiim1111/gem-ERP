import { CountLineFlag, InventoryCountStatus, Prisma } from '@prisma/client';
import {
  activeQuantityField,
  canCountTransition,
  classifyAssetLine,
  classifyQuantityLine,
  computeVarianceQuantity,
  countTransitionError,
  effectiveCountedQuantity,
  shouldMaskExpected,
} from './count-rules';

const D = (value: string) => new Prisma.Decimal(value);

describe('count session state machine (spec §17, status-transitions §6)', () => {
  it('DRAFT allows update, start, cancel — nothing else', () => {
    expect(canCountTransition(InventoryCountStatus.DRAFT, 'update')).toBe(true);
    expect(canCountTransition(InventoryCountStatus.DRAFT, 'start')).toBe(true);
    expect(canCountTransition(InventoryCountStatus.DRAFT, 'cancel')).toBe(true);
    expect(canCountTransition(InventoryCountStatus.DRAFT, 'record')).toBe(false);
    expect(canCountTransition(InventoryCountStatus.DRAFT, 'complete')).toBe(false);
    expect(
      canCountTransition(InventoryCountStatus.DRAFT, 'create-adjustments'),
    ).toBe(false);
  });

  it('IN_PROGRESS allows recording, recount, complete, cancel — not editing scope', () => {
    expect(canCountTransition(InventoryCountStatus.IN_PROGRESS, 'record')).toBe(true);
    expect(canCountTransition(InventoryCountStatus.IN_PROGRESS, 'recount')).toBe(true);
    expect(canCountTransition(InventoryCountStatus.IN_PROGRESS, 'complete')).toBe(true);
    expect(canCountTransition(InventoryCountStatus.IN_PROGRESS, 'cancel')).toBe(true);
    expect(canCountTransition(InventoryCountStatus.IN_PROGRESS, 'update')).toBe(false);
    expect(canCountTransition(InventoryCountStatus.IN_PROGRESS, 'start')).toBe(false);
  });

  it('REVIEW (counting closed, lines locked) allows only recount, create-adjustments, cancel', () => {
    expect(canCountTransition(InventoryCountStatus.REVIEW, 'recount')).toBe(true);
    expect(
      canCountTransition(InventoryCountStatus.REVIEW, 'create-adjustments'),
    ).toBe(true);
    expect(canCountTransition(InventoryCountStatus.REVIEW, 'cancel')).toBe(true);
    expect(canCountTransition(InventoryCountStatus.REVIEW, 'record')).toBe(false);
    expect(canCountTransition(InventoryCountStatus.REVIEW, 'complete')).toBe(false);
  });

  it('COMPLETED and CANCELED are terminal', () => {
    for (const event of [
      'update',
      'start',
      'record',
      'recount',
      'complete',
      'create-adjustments',
      'cancel',
    ] as const) {
      expect(canCountTransition(InventoryCountStatus.COMPLETED, event)).toBe(false);
      expect(canCountTransition(InventoryCountStatus.CANCELED, event)).toBe(false);
    }
    expect(
      countTransitionError(InventoryCountStatus.COMPLETED, 'record'),
    ).toContain('terminal');
  });
});

describe('blind masking (expected quantities hidden until complete)', () => {
  it('masks blind sessions while DRAFT or IN_PROGRESS', () => {
    expect(
      shouldMaskExpected({ isBlind: true, status: InventoryCountStatus.DRAFT }),
    ).toBe(true);
    expect(
      shouldMaskExpected({
        isBlind: true,
        status: InventoryCountStatus.IN_PROGRESS,
      }),
    ).toBe(true);
  });

  it('reveals from REVIEW on, and never masks non-blind sessions', () => {
    expect(
      shouldMaskExpected({ isBlind: true, status: InventoryCountStatus.REVIEW }),
    ).toBe(false);
    expect(
      shouldMaskExpected({
        isBlind: true,
        status: InventoryCountStatus.COMPLETED,
      }),
    ).toBe(false);
    expect(
      shouldMaskExpected({
        isBlind: false,
        status: InventoryCountStatus.IN_PROGRESS,
      }),
    ).toBe(false);
  });
});

describe('variance math — snapshot isolation', () => {
  it('variance = effective counted − FROZEN snapshot expectation', () => {
    expect(
      computeVarianceQuantity({
        expectedQuantity: D('100'),
        countedQuantity: D('97'),
        recountQuantity: null,
      }).toString(),
    ).toBe('-3');
    expect(
      computeVarianceQuantity({
        expectedQuantity: D('10'),
        countedQuantity: D('12.5'),
        recountQuantity: null,
      }).toString(),
    ).toBe('2.5');
  });

  it('is computed from the line snapshot ONLY — stock moving after the freeze cannot corrupt it', () => {
    // The physical shelf held 95 when counted. A receipt posted AFTER the
    // snapshot bumped the live balance to 120 — irrelevant: the line's
    // frozen expectedQuantity (100) is the only expectation consulted, so
    // the variance stays −5 no matter what the ledger did meanwhile.
    const lineFrozenAtStart = {
      expectedQuantity: D('100'),
      countedQuantity: D('95'),
      recountQuantity: null,
    };
    const varianceBeforeMovement = computeVarianceQuantity(lineFrozenAtStart);
    const varianceAfterMovement = computeVarianceQuantity(lineFrozenAtStart);
    expect(varianceBeforeMovement.toString()).toBe('-5');
    expect(varianceAfterMovement.toString()).toBe('-5');
  });

  it('recount supersedes the first count', () => {
    const line = {
      expectedQuantity: D('50'),
      countedQuantity: D('40'),
      recountQuantity: D('49'),
    };
    expect(effectiveCountedQuantity(line)?.toString()).toBe('49');
    expect(computeVarianceQuantity(line).toString()).toBe('-1');
  });

  it('uncounted lines count as 0 found (full negative variance)', () => {
    expect(
      computeVarianceQuantity({
        expectedQuantity: D('7'),
        countedQuantity: null,
        recountQuantity: null,
      }).toString(),
    ).toBe('-7');
  });

  it('keeps 4-decimal precision through Decimal math', () => {
    expect(
      computeVarianceQuantity({
        expectedQuantity: D('0.3'),
        countedQuantity: D('0.1'),
        recountQuantity: null,
      }).toString(),
    ).toBe('-0.2'); // 0.1 - 0.3 in floats would drift
  });

  it('recount pass writes recountQuantity, first pass writes countedQuantity', () => {
    expect(activeQuantityField({ recountRequested: false })).toBe(
      'countedQuantity',
    );
    expect(activeQuantityField({ recountRequested: true })).toBe(
      'recountQuantity',
    );
  });
});

describe('line classification at complete', () => {
  it('quantity lines: zero variance → MATCHED, otherwise VARIANCE', () => {
    expect(
      classifyQuantityLine({
        expectedQuantity: D('10'),
        countedQuantity: D('10'),
        recountQuantity: null,
        flag: null,
      }),
    ).toBe(CountLineFlag.MATCHED);
    expect(
      classifyQuantityLine({
        expectedQuantity: D('10'),
        countedQuantity: D('8'),
        recountQuantity: null,
        flag: null,
      }),
    ).toBe(CountLineFlag.VARIANCE);
  });

  it('quantity lines: UNEXPECTED and DUPLICATE findings are preserved', () => {
    expect(
      classifyQuantityLine({
        expectedQuantity: D('0'),
        countedQuantity: D('3'),
        recountQuantity: null,
        flag: CountLineFlag.UNEXPECTED,
      }),
    ).toBe(CountLineFlag.UNEXPECTED);
    expect(
      classifyQuantityLine({
        expectedQuantity: D('10'),
        countedQuantity: D('10'),
        recountQuantity: null,
        flag: CountLineFlag.DUPLICATE,
      }),
    ).toBe(CountLineFlag.DUPLICATE);
  });

  it('asset lines: never verified or not found → MISSING', () => {
    expect(
      classifyAssetLine({ assetFound: null, locationConfirmed: null, flag: null }),
    ).toBe(CountLineFlag.MISSING);
    expect(
      classifyAssetLine({
        assetFound: false,
        locationConfirmed: null,
        flag: null,
      }),
    ).toBe(CountLineFlag.MISSING);
  });

  it('asset lines: found in the wrong place → MISPLACED; verified twice → DUPLICATE; clean → MATCHED', () => {
    expect(
      classifyAssetLine({
        assetFound: true,
        locationConfirmed: false,
        flag: null,
      }),
    ).toBe(CountLineFlag.MISPLACED);
    expect(
      classifyAssetLine({
        assetFound: true,
        locationConfirmed: true,
        flag: CountLineFlag.DUPLICATE,
      }),
    ).toBe(CountLineFlag.DUPLICATE);
    expect(
      classifyAssetLine({
        assetFound: true,
        locationConfirmed: true,
        flag: null,
      }),
    ).toBe(CountLineFlag.MATCHED);
  });

  it('asset lines: scanned outside the snapshot stays UNEXPECTED even when found', () => {
    expect(
      classifyAssetLine({
        assetFound: true,
        locationConfirmed: true,
        flag: CountLineFlag.UNEXPECTED,
      }),
    ).toBe(CountLineFlag.UNEXPECTED);
  });
});
