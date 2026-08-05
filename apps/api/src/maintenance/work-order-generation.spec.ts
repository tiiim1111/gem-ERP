import { AssetLifecycleStatus } from '@prisma/client';
import {
  CoveredAsset,
  GENERATION_ELIGIBLE_STATUSES,
  generatedProblemDescription,
  isGenerationEligible,
  selectAssetsNeedingWorkOrder,
} from './work-order-generation';

const A = AssetLifecycleStatus;

function asset(
  assetId: string,
  status: AssetLifecycleStatus = A.AVAILABLE,
  archived = false,
): CoveredAsset {
  return { assetId, status, archived };
}

describe('work-order-generation (worker-job idempotency, pure logic)', () => {
  describe('lifecycle eligibility', () => {
    it.each(GENERATION_ELIGIBLE_STATUSES)('%s is eligible', (status) => {
      expect(isGenerationEligible(status)).toBe(true);
    });

    it.each([A.DRAFT, A.UNDER_MAINTENANCE, A.LOST, A.RETIRED, A.DISPOSED])(
      '%s is NOT eligible',
      (status) => {
        expect(isGenerationEligible(status)).toBe(false);
      },
    );
  });

  describe('selectAssetsNeedingWorkOrder — exactly ONE open WO per plan+asset', () => {
    it('selects eligible covered assets without an open plan WO', () => {
      expect(
        selectAssetsNeedingWorkOrder(
          [asset('a1'), asset('a2', A.ASSIGNED), asset('a3', A.DAMAGED)],
          new Set(),
        ),
      ).toEqual(['a1', 'a2', 'a3']);
    });

    it('an existing open WO suppresses generation (the idempotency core)', () => {
      const covered = [asset('a1'), asset('a2')];
      const firstRun = selectAssetsNeedingWorkOrder(covered, new Set());
      expect(firstRun).toEqual(['a1', 'a2']);
      // Simulate the WOs the first run created still being open:
      const secondRun = selectAssetsNeedingWorkOrder(covered, new Set(firstRun));
      expect(secondRun).toEqual([]);
    });

    it('re-runs generate only for assets whose WO has closed since', () => {
      const covered = [asset('a1'), asset('a2')];
      // a1's WO completed (no longer open); a2's is still open.
      expect(
        selectAssetsNeedingWorkOrder(covered, new Set(['a2'])),
      ).toEqual(['a1']);
    });

    it('skips archived and lifecycle-ineligible assets', () => {
      expect(
        selectAssetsNeedingWorkOrder(
          [
            asset('a1', A.AVAILABLE, true), // archived
            asset('a2', A.RETIRED),
            asset('a3', A.UNDER_MAINTENANCE), // already being serviced
            asset('a4'),
          ],
          new Set(),
        ),
      ).toEqual(['a4']);
    });

    it('an empty covered set generates nothing', () => {
      expect(selectAssetsNeedingWorkOrder([], new Set())).toEqual([]);
    });
  });

  describe('generatedProblemDescription', () => {
    it('carries the plan identity and due date', () => {
      expect(
        generatedProblemDescription('MPL-00001', 'Laptop service', new Date('2026-08-19T00:00:00.000Z')),
      ).toBe('[preventive] Generated from plan MPL-00001 (Laptop service) — due 2026-08-19');
    });

    it('omits the due suffix for dateless (meter) plans', () => {
      expect(generatedProblemDescription('MPL-00002', 'Drill service', null)).toBe(
        '[preventive] Generated from plan MPL-00002 (Drill service)',
      );
    });
  });
});
