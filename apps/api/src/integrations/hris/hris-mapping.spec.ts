import { EmployeeStatus } from '@prisma/client';
import {
  buildDisplayName,
  decideRow,
  HRIS_ISSUE,
  mapEmploymentStatus,
  type DecideInput,
  type ExistingEmployee,
} from './hris-mapping';
import type { HrisEmployee } from './hris-payload';

const OBSERVED = new Date('2026-10-21T02:00:00.000Z');

function feed(overrides: Partial<HrisEmployee> = {}): HrisEmployee {
  return {
    hrisId: 'hris-1',
    employeeNumber: 'GC-0001',
    firstName: 'Ana',
    middleName: null,
    lastName: 'Reyes',
    workEmail: null,
    departmentCode: 'ADMIN',
    positionCode: 'ITO',
    employmentStatus: 'ACTIVE',
    dateHired: '2024-03-04',
    archivedAt: null,
    updatedAt: '2026-10-20T06:12:44.000Z',
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingEmployee> = {}): ExistingEmployee {
  return {
    id: 'emp-1',
    employeeNumber: 'GC-0001',
    firstName: 'Ana',
    middleName: null,
    lastName: 'Reyes',
    displayName: 'Ana Reyes',
    workEmail: null,
    departmentId: 'dept-1',
    positionId: 'pos-1',
    status: EmployeeStatus.ACTIVE,
    startDate: new Date('2024-03-04T00:00:00.000Z'),
    separationDate: null,
    separationDateInferred: false,
    hrisId: 'hris-1',
    ...overrides,
  };
}

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    feed: feed(),
    existing: null,
    lookups: { departmentId: 'dept-1', positionId: 'pos-1' },
    departmentUnmapped: false,
    positionUnmapped: false,
    duplicateInSnapshot: false,
    emailTakenByOther: false,
    employeeNumberTakenByOther: false,
    defaultBranchId: 'branch-1',
    observedAt: OBSERVED,
    ...overrides,
  };
}

const codes = (decision: { issues: Array<{ code: string }> }) =>
  decision.issues.map((issue) => issue.code);

describe('mapEmploymentStatus', () => {
  it.each([
    ['ACTIVE', EmployeeStatus.ACTIVE],
    ['INACTIVE', EmployeeStatus.INACTIVE],
    ['RESIGNED', EmployeeStatus.SEPARATED],
    ['TERMINATED', EmployeeStatus.SEPARATED],
  ])('maps %s to %s', (raw, expected) => {
    expect(mapEmploymentStatus(raw)).toEqual({ status: expected, unknown: false });
  });

  it('is tolerant of case and padding', () => {
    expect(mapEmploymentStatus('  resigned ').status).toBe(EmployeeStatus.SEPARATED);
  });

  /*
   * The HRIS enum could grow. INACTIVE is the safe end — it stops new asset
   * issuance without asserting the person has left — and the row is flagged
   * so nobody mistakes the default for a decision.
   */
  it.each([['PROBATIONARY'], ['AWOL'], ['FLOATING'], ['']])(
    'falls back to a flagged INACTIVE for %p',
    (raw) => {
      expect(mapEmploymentStatus(raw)).toEqual({
        status: EmployeeStatus.INACTIVE,
        unknown: true,
      });
    },
  );
});

describe('decideRow', () => {
  describe('creating', () => {
    it('creates an unknown employee', () => {
      const decision = decideRow(input());
      expect(decision.action).toBe('create');
      expect(decision.data?.employeeNumber).toBe('GC-0001');
      expect(decision.issues).toHaveLength(0);
    });

    /*
     * GEM-ENI requires a branch on every employee and the HRIS has none, so
     * without a configured default there is nothing to create the row with.
     * Skipping loudly beats inventing a placement.
     */
    it('skips a creation when no default branch is configured', () => {
      const decision = decideRow(input({ defaultBranchId: null }));
      expect(decision.action).toBe('skip');
      expect(codes(decision)).toContain(HRIS_ISSUE.noDefaultBranch);
    });

    it('still updates an existing employee without a default branch', () => {
      const decision = decideRow(
        input({ existing: existing({ firstName: 'Anna' }), defaultBranchId: null }),
      );
      expect(decision.action).toBe('update');
    });
  });

  describe('linking and updating', () => {
    it('links a previously unlinked employee', () => {
      const decision = decideRow(input({ existing: existing({ hrisId: null }) }));
      expect(decision.action).toBe('link');
      expect(decision.employeeId).toBe('emp-1');
    });

    it('reports no change when nothing the sync owns differs', () => {
      expect(decideRow(input({ existing: existing() })).action).toBe('unchanged');
    });

    it.each([
      ['firstName', { firstName: 'Anna' }],
      ['employeeNumber', { employeeNumber: 'GC-9999' }],
      ['department', { departmentId: 'dept-other' }],
      ['status', { status: EmployeeStatus.INACTIVE }],
    ])('updates when %s differs', (_label, overrides) => {
      expect(decideRow(input({ existing: existing(overrides) })).action).toBe('update');
    });

    /*
     * A nightly run over an unchanged roster must not bump the version and the
     * audit trail on every employee every night.
     */
    it('ignores GEM-ENI-owned differences', () => {
      const decision = decideRow(
        input({ existing: existing({ displayName: 'Ana R.' }) }),
      );
      expect(decision.action).toBe('unchanged');
    });
  });

  describe('what a sync may write', () => {
    /*
     * The written field set is the control that keeps branch, supervisor, the
     * login link, notes and custody out of reach — by construction rather than
     * by remembering to exclude them.
     */
    it('never includes a GEM-ENI-owned field', () => {
      const decision = decideRow(input());
      const keys = Object.keys(decision.data ?? {});
      expect(keys).not.toContain('branchId');
      expect(keys).not.toContain('supervisorId');
      expect(keys).not.toContain('userId');
      expect(keys).not.toContain('notes');
      expect(keys).not.toContain('photoUrl');
      expect(keys).not.toContain('displayName');
    });
  });

  describe('unmapped organisational codes', () => {
    it('skips an unmapped department rather than filing the person anywhere', () => {
      const decision = decideRow(input({ departmentUnmapped: true }));
      expect(decision.action).toBe('skip');
      expect(codes(decision)).toEqual([HRIS_ISSUE.unmappedDepartment]);
    });

    it('skips an unmapped position', () => {
      const decision = decideRow(input({ positionUnmapped: true }));
      expect(decision.action).toBe('skip');
      expect(codes(decision)).toEqual([HRIS_ISSUE.unmappedPosition]);
    });

    it('accepts a record with no department at all', () => {
      const decision = decideRow(
        input({
          feed: feed({ departmentCode: null }),
          lookups: { departmentId: null, positionId: 'pos-1' },
        }),
      );
      expect(decision.action).toBe('create');
      expect(decision.data?.departmentId).toBeNull();
    });
  });

  describe('uniqueness conflicts', () => {
    it('quarantines a number duplicated inside the snapshot', () => {
      const decision = decideRow(input({ duplicateInSnapshot: true }));
      expect(decision.action).toBe('skip');
      expect(codes(decision)).toEqual([HRIS_ISSUE.duplicateEmployeeNumber]);
    });

    it('refuses to reassign a number another employee holds', () => {
      const decision = decideRow(input({ employeeNumberTakenByOther: true }));
      expect(decision.action).toBe('skip');
      expect(codes(decision)).toEqual([HRIS_ISSUE.employeeNumberConflict]);
    });

    /*
     * Dropping the email on THIS row, rather than overwriting the other
     * person's, keeps a producer-side duplicate from damaging a record that is
     * not even part of the change.
     */
    it('drops a conflicting email instead of overwriting the other employee', () => {
      const decision = decideRow(
        input({ feed: feed({ workEmail: 'admin@gemcor.ph' }), emailTakenByOther: true }),
      );
      expect(decision.action).toBe('create');
      expect(decision.data?.workEmail).toBeNull();
      expect(codes(decision)).toContain(HRIS_ISSUE.emailConflict);
    });

    it('keeps a unique email', () => {
      const decision = decideRow(input({ feed: feed({ workEmail: 'areyes@gemcor.ph' }) }));
      expect(decision.data?.workEmail).toBe('areyes@gemcor.ph');
      expect(codes(decision)).not.toContain(HRIS_ISSUE.emailConflict);
    });
  });

  describe('separation', () => {
    /*
     * The HRIS has no separation-date column, and its archive timestamp is an
     * administrative action rather than a separation. So the date is the one we
     * observed, marked inferred — which is what lets asset clearance run at all.
     */
    it('infers the separation date on first observation', () => {
      const decision = decideRow(
        input({ feed: feed({ employmentStatus: 'RESIGNED' }), existing: existing() }),
      );
      expect(decision.data?.status).toBe(EmployeeStatus.SEPARATED);
      expect(decision.data?.separationDate).toEqual(OBSERVED);
      expect(decision.data?.separationDateInferred).toBe(true);
      expect(codes(decision)).toContain(HRIS_ISSUE.inferredSeparationWithAssets);
    });

    it('never overwrites a separation date already on record', () => {
      const recorded = new Date('2026-08-31T00:00:00.000Z');
      const decision = decideRow(
        input({
          feed: feed({ employmentStatus: 'TERMINATED' }),
          existing: existing({
            status: EmployeeStatus.SEPARATED,
            separationDate: recorded,
            separationDateInferred: false,
          }),
        }),
      );
      expect(decision.data?.separationDate).toEqual(recorded);
      expect(decision.data?.separationDateInferred).toBe(false);
    });

    it('does not re-flag an already separated employee every night', () => {
      const decision = decideRow(
        input({
          feed: feed({ employmentStatus: 'RESIGNED' }),
          existing: existing({
            status: EmployeeStatus.SEPARATED,
            separationDate: new Date('2026-08-31T00:00:00.000Z'),
          }),
        }),
      );
      expect(codes(decision)).not.toContain(HRIS_ISSUE.inferredSeparationWithAssets);
      expect(decision.action).toBe('unchanged');
    });

    it('never derives a separation date from the archive timestamp', () => {
      const decision = decideRow(
        input({
          feed: feed({ employmentStatus: 'INACTIVE', archivedAt: '2026-09-01T03:00:00.000Z' }),
          existing: existing(),
        }),
      );
      expect(decision.data?.separationDate).toBeNull();
      expect(decision.data?.status).toBe(EmployeeStatus.INACTIVE);
    });
  });

  describe('review flags', () => {
    it('flags an unrecognised status without guessing', () => {
      const decision = decideRow(input({ feed: feed({ employmentStatus: 'AWOL' }) }));
      expect(decision.data?.status).toBe(EmployeeStatus.INACTIVE);
      expect(codes(decision)).toContain(HRIS_ISSUE.unknownStatus);
    });

    /*
     * Archiving forces INACTIVE in the HRIS, so status alone cannot tell
     * "archived" from "inactive" — and they are different situations for
     * somebody holding a company laptop.
     */
    it('flags an archived INACTIVE record for confirmation', () => {
      const decision = decideRow(
        input({ feed: feed({ employmentStatus: 'INACTIVE', archivedAt: '2026-09-01T03:00:00.000Z' }) }),
      );
      expect(codes(decision)).toContain(HRIS_ISSUE.archivedInactive);
    });

    it('does not flag an archived record that is already separated', () => {
      const decision = decideRow(
        input({ feed: feed({ employmentStatus: 'RESIGNED', archivedAt: '2026-09-01T03:00:00.000Z' }) }),
      );
      expect(codes(decision)).not.toContain(HRIS_ISSUE.archivedInactive);
    });
  });

  describe('dates', () => {
    it('stores the hire date at UTC midnight', () => {
      expect(decideRow(input()).data?.startDate).toEqual(new Date('2024-03-04T00:00:00.000Z'));
    });

    it('accepts a missing hire date', () => {
      expect(decideRow(input({ feed: feed({ dateHired: null }) })).data?.startDate).toBeNull();
    });
  });
});

describe('buildDisplayName', () => {
  // The HRIS has no display-name column, so GEM-ENI builds one.
  it('joins first and last name', () => {
    expect(buildDisplayName(feed())).toBe('Ana Reyes');
  });

  it('collapses stray whitespace', () => {
    expect(buildDisplayName(feed({ firstName: 'Ana  Maria' }))).toBe('Ana Maria Reyes');
  });
});
