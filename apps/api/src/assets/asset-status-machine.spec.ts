import { HttpException } from '@nestjs/common';
import { AssetLifecycleStatus } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import {
  assertTransition,
  canTransition,
  permittedActions,
  type AssetEvent,
} from './asset-status-machine';

const S = AssetLifecycleStatus;
const ALL_STATUSES: AssetLifecycleStatus[] = [
  S.DRAFT,
  S.AVAILABLE,
  S.RESERVED,
  S.ASSIGNED,
  S.IN_TRANSFER,
  S.UNDER_INSPECTION,
  S.UNDER_MAINTENANCE,
  S.DAMAGED,
  S.LOST,
  S.RETIRED,
  S.DISPOSED,
];

/**
 * The transition table transcribed INDEPENDENTLY from
 * docs/status-transitions.md §1.1 — the test would catch the implementation
 * drifting from the document (and vice versa).
 */
const DOC_FROM_SETS: Record<AssetEvent, AssetLifecycleStatus[]> = {
  activate: [S.DRAFT],
  reserve: [S.AVAILABLE],
  release: [S.RESERVED],
  assign: [S.AVAILABLE, S.RESERVED],
  reassign: [S.ASSIGNED],
  return: [S.ASSIGNED],
  'return-damaged': [S.ASSIGNED],
  'report-damage': [S.AVAILABLE, S.RESERVED, S.ASSIGNED],
  'report-loss': [S.AVAILABLE, S.ASSIGNED, S.IN_TRANSFER],
  'send-to-inspection': [S.AVAILABLE, S.ASSIGNED, S.DAMAGED],
  'inspection-pass': [S.UNDER_INSPECTION],
  'inspection-fail': [S.UNDER_INSPECTION],
  'send-to-maintenance': [S.AVAILABLE, S.ASSIGNED, S.DAMAGED, S.UNDER_INSPECTION],
  'maintenance-complete': [S.UNDER_MAINTENANCE],
  recover: [S.LOST],
  'write-off': [S.LOST],
  retire: [S.AVAILABLE, S.DAMAGED],
  dispose: [S.RETIRED],
  'reverse-disposal': [S.DISPOSED],
  dispatch: [S.AVAILABLE, S.RESERVED],
  receive: [S.IN_TRANSFER],
  'receive-damaged': [S.IN_TRANSFER],
  'lost-in-transit': [S.IN_TRANSFER],
};

const ALL_EVENTS = Object.keys(DOC_FROM_SETS) as AssetEvent[];

function expectInvalidTransition(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const http = caught as HttpException;
  expect(http.getStatus()).toBe(409);
  expect(
    (http.getResponse() as { error: { code: string } }).error.code,
  ).toBe('INVALID_STATE_TRANSITION');
}

describe('asset status machine', () => {
  it('allows every legal transition from the document matrix', () => {
    for (const event of ALL_EVENTS) {
      for (const status of DOC_FROM_SETS[event]) {
        expect(canTransition(status, event)).toBe(true);
        expect(() => assertTransition(status, event)).not.toThrow();
      }
    }
  });

  it('rejects EVERY illegal state/event combination with 409 INVALID_STATE_TRANSITION', () => {
    let checked = 0;
    for (const event of ALL_EVENTS) {
      const allowed = new Set(DOC_FROM_SETS[event]);
      for (const status of ALL_STATUSES) {
        if (allowed.has(status)) {
          continue;
        }
        expect(canTransition(status, event)).toBe(false);
        expectInvalidTransition(() => assertTransition(status, event));
        checked += 1;
      }
    }
    // 23 events × 11 statuses minus the legal pairs — the whole grid walked.
    const legalPairs = ALL_EVENTS.reduce(
      (sum, event) => sum + DOC_FROM_SETS[event].length,
      0,
    );
    expect(checked).toBe(ALL_EVENTS.length * ALL_STATUSES.length - legalPairs);
  });

  it('a Disposed asset accepts reverse-disposal and NOTHING else', () => {
    for (const event of ALL_EVENTS) {
      if (event === 'reverse-disposal') {
        expect(assertTransition(S.DISPOSED, event)).toBe(S.RETIRED);
      } else {
        expectInvalidTransition(() => assertTransition(S.DISPOSED, event));
      }
    }
  });

  it('forbidden-table spot checks (doc §1.2)', () => {
    // Under Maintenance cannot dispatch / assign / reserve.
    expectInvalidTransition(() => assertTransition(S.UNDER_MAINTENANCE, 'dispatch'));
    expectInvalidTransition(() => assertTransition(S.UNDER_MAINTENANCE, 'assign'));
    expectInvalidTransition(() => assertTransition(S.UNDER_MAINTENANCE, 'reserve'));
    // Lost can never be assigned/reserved/dispatched or retired except write-off.
    expectInvalidTransition(() => assertTransition(S.LOST, 'assign'));
    expectInvalidTransition(() => assertTransition(S.LOST, 'reserve'));
    expectInvalidTransition(() => assertTransition(S.LOST, 'dispatch'));
    expect(assertTransition(S.LOST, 'recover')).toBe(S.UNDER_INSPECTION);
    expect(assertTransition(S.LOST, 'write-off')).toBe(S.RETIRED);
    // Draft goes nowhere but Available.
    expectInvalidTransition(() => assertTransition(S.DRAFT, 'assign'));
    expectInvalidTransition(() => assertTransition(S.DRAFT, 'retire'));
    expect(assertTransition(S.DRAFT, 'activate')).toBe(S.AVAILABLE);
    // Damaged cannot be assigned directly.
    expectInvalidTransition(() => assertTransition(S.DAMAGED, 'assign'));
    // Assigned cannot dispatch directly.
    expectInvalidTransition(() => assertTransition(S.ASSIGNED, 'dispatch'));
    // Retired cannot be assigned/reserved/dispatched.
    expectInvalidTransition(() => assertTransition(S.RETIRED, 'assign'));
    expectInvalidTransition(() => assertTransition(S.RETIRED, 'dispatch'));
  });

  it('maintenance-complete honors the chosen outcome and rejects others', () => {
    expect(
      assertTransition(S.UNDER_MAINTENANCE, 'maintenance-complete', S.ASSIGNED),
    ).toBe(S.ASSIGNED);
    expect(
      assertTransition(S.UNDER_MAINTENANCE, 'maintenance-complete', S.RETIRED),
    ).toBe(S.RETIRED);
    expectInvalidTransition(() =>
      assertTransition(S.UNDER_MAINTENANCE, 'maintenance-complete', S.DRAFT),
    );
    expectInvalidTransition(() =>
      assertTransition(S.UNDER_MAINTENANCE, 'maintenance-complete', S.LOST),
    );
  });

  describe('permittedActions', () => {
    it('filters by both current status and held permissions', () => {
      const custodianUser = {
        isSuperAdmin: false,
        permissions: [PERMISSIONS.asset.assign],
      };
      expect(permittedActions(S.AVAILABLE, custodianUser)).toEqual([
        'reserve',
        'assign',
      ]);
      // No permissions → no actions, regardless of status.
      expect(
        permittedActions(S.AVAILABLE, { isSuperAdmin: false, permissions: [] }),
      ).toEqual([]);
    });

    it('super admin sees every action legal for the status', () => {
      const admin = { isSuperAdmin: true, permissions: [] };
      expect(permittedActions(S.DISPOSED, admin)).toEqual(['reverse-disposal']);
      expect(permittedActions(S.DRAFT, admin)).toEqual(['activate']);
      expect(permittedActions(S.LOST, admin)).toEqual([
        'recover',
        'write-off',
      ]);
    });
  });
});
