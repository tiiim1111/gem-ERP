import { MaintenanceWorkOrderStatus, Prisma } from '@prisma/client';
import {
  canTransitionWo,
  computeWorkOrderTotalCost,
  HOLD_REASONS,
  holdTargetStatus,
  OPEN_WO_STATUSES,
  RESUMABLE_STATUSES,
  sumPartsCost,
  TERMINAL_WO_STATUSES,
  woTransitionError,
  WorkOrderEvent,
} from './work-order-rules';

const S = MaintenanceWorkOrderStatus;
const D = (value: string | number) => new Prisma.Decimal(value);

describe('work-order-rules (pure state machine)', () => {
  describe('transition matrix (docs/status-transitions.md §5)', () => {
    const allowed: Array<[MaintenanceWorkOrderStatus, WorkOrderEvent]> = [
      [S.OPEN, 'update'],
      [S.OPEN, 'assign'],
      [S.OPEN, 'schedule'],
      [S.OPEN, 'replace-tasks'],
      [S.OPEN, 'cancel'],
      [S.ASSIGNED, 'assign'], // re-designation
      [S.ASSIGNED, 'schedule'],
      [S.ASSIGNED, 'start'],
      [S.SCHEDULED, 'start'],
      [S.SCHEDULED, 'assign'],
      [S.IN_PROGRESS, 'hold'],
      [S.IN_PROGRESS, 'issue-parts'],
      [S.IN_PROGRESS, 'complete-task'],
      [S.IN_PROGRESS, 'complete'],
      [S.IN_PROGRESS, 'cancel'],
      [S.ON_HOLD, 'resume'],
      [S.AWAITING_PARTS, 'resume'],
      [S.AWAITING_PARTS, 'issue-parts'], // posting the issue = parts-received
      [S.AWAITING_VENDOR, 'resume'],
      [S.AWAITING_VENDOR, 'cancel'],
      [S.COMPLETED, 'verify'],
    ];
    it.each(allowed)('%s allows %s', (from, event) => {
      expect(canTransitionWo(from, event)).toBe(true);
    });

    const forbidden: Array<[MaintenanceWorkOrderStatus, WorkOrderEvent]> = [
      [S.OPEN, 'start'], // must be assigned or scheduled first
      [S.OPEN, 'complete'],
      [S.OPEN, 'hold'],
      [S.ASSIGNED, 'complete'],
      [S.ASSIGNED, 'hold'],
      [S.IN_PROGRESS, 'start'], // already started
      [S.IN_PROGRESS, 'assign'],
      [S.IN_PROGRESS, 'schedule'],
      [S.IN_PROGRESS, 'resume'],
      [S.ON_HOLD, 'complete'], // resume first
      [S.ON_HOLD, 'start'],
      [S.AWAITING_VENDOR, 'issue-parts'],
      [S.COMPLETED, 'update'], // completed WOs are closed for edits
      [S.COMPLETED, 'cancel'],
      [S.COMPLETED, 'complete'],
      [S.VERIFIED, 'verify'], // terminal
      [S.VERIFIED, 'cancel'],
      [S.VERIFIED, 'update'],
      [S.CANCELED, 'update'], // terminal
      [S.CANCELED, 'assign'],
      [S.CANCELED, 'verify'],
    ];
    it.each(forbidden)('%s forbids %s', (from, event) => {
      expect(canTransitionWo(from, event)).toBe(false);
    });

    it('error messages name the status and the allowed events', () => {
      expect(woTransitionError(S.VERIFIED, 'cancel')).toContain('terminal');
      expect(woTransitionError(S.OPEN, 'complete')).toContain('assign');
    });
  });

  describe('hold reasons map onto waiting statuses', () => {
    it('covers exactly the contract’s three reasons', () => {
      expect(HOLD_REASONS).toEqual(['On Hold', 'Awaiting Parts', 'Awaiting Vendor']);
    });

    it.each([
      ['On Hold', S.ON_HOLD],
      ['Awaiting Parts', S.AWAITING_PARTS],
      ['Awaiting Vendor', S.AWAITING_VENDOR],
    ] as const)('%s → %s', (reason, status) => {
      expect(holdTargetStatus(reason)).toBe(status);
    });

    it('every hold target is resumable', () => {
      for (const reason of HOLD_REASONS) {
        expect(RESUMABLE_STATUSES).toContain(holdTargetStatus(reason));
      }
    });
  });

  describe('open/terminal partitions', () => {
    it('every status is exactly one of open or terminal', () => {
      for (const status of Object.values(S)) {
        expect(
          OPEN_WO_STATUSES.includes(status) !== TERMINAL_WO_STATUSES.includes(status),
        ).toBe(true);
      }
    });
  });

  describe('cost math (Decimal)', () => {
    it('total = labor + parts + external', () => {
      expect(
        computeWorkOrderTotalCost(D('500.00'), D('164.00'), D('0')).toString(),
      ).toBe('664');
    });

    it('nulls count as zero', () => {
      expect(computeWorkOrderTotalCost(null, D('164.00'), null).toString()).toBe('164');
      expect(computeWorkOrderTotalCost(null, null, null).toString()).toBe('0');
    });

    it('sums part totals and skips null costs', () => {
      expect(
        sumPartsCost([
          { totalCost: D('164.00') },
          { totalCost: null },
          { totalCost: D('35.50') },
        ]).toString(),
      ).toBe('199.5');
    });
  });
});
