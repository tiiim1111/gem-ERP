import { EmployeeStatus, HrisSyncStatus, HrisSyncTrigger } from '@prisma/client';
import { HrisSyncService } from './hris-sync.service';
import { HrisTransportError } from './hris-client.service';
import { HRIS_ISSUE } from './hris-mapping';
import type { HrisEmployee, HrisSnapshot } from './hris-payload';

/*
 * Behaviour of the engine around the edges that matter operationally: a dry
 * run must be a true rehearsal, a failed fetch must apply nothing, and an
 * employee missing from a snapshot must never be acted on.
 */

type MockFn = jest.Mock;

interface PrismaMock {
  hrisSyncRun: {
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
    update: MockFn;
  };
  hrisSyncIssue: { createMany: MockFn };
  hrisDepartmentMap: { findUnique: MockFn; create: MockFn };
  hrisPositionMap: { findUnique: MockFn; create: MockFn };
  employee: { findFirst: MockFn; findMany: MockFn; create: MockFn; update: MockFn };
  asset: { count: MockFn };
  branch: { findFirst: MockFn };
  department: { findFirst: MockFn };
  position: { findFirst: MockFn };
  user: { findMany: MockFn };
  $queryRaw: MockFn;
  $transaction: MockFn;
}

/**
 * What the database holds for a test.
 *
 * The engine asks `employee.findFirst`/`findMany` several unrelated questions
 * — is this hrisId linked, is there one unlinked row with this number, does
 * anyone else hold this email or number, which rows are linked at all. One
 * blanket mock answers them all with the same row and quietly changes the
 * decision, so the mock routes on the query shape instead.
 */
interface EmployeeFixtures {
  /** Already linked to the HRIS, by hrisId. */
  linked: Record<string, ExistingRow>;
  /** Unlinked GEM-ENI rows that carry a given employee number. */
  unlinkedByNumber: Record<string, ExistingRow[]>;
  /** Emails some *other* employee holds. */
  emailHolders: string[];
  /** Employee numbers some *other* employee holds. */
  numberHolders: string[];
  /** Rows carrying an hrisId, for the missing-from-snapshot sweep. */
  linkedIndex: Array<{ id: string; hrisId: string; employeeNumber: string }>;
}

interface ExistingRow {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  displayName: string | null;
  workEmail: string | null;
  departmentId: string | null;
  positionId: string | null;
  status: EmployeeStatus;
  startDate: Date | null;
  separationDate: Date | null;
  separationDateInferred: boolean;
  hrisId: string | null;
}

export function employeeRow(overrides: Partial<ExistingRow> = {}): ExistingRow {
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

function emptyFixtures(): EmployeeFixtures {
  return {
    linked: {},
    unlinkedByNumber: {},
    emailHolders: [],
    numberHolders: [],
    linkedIndex: [],
  };
}

function prismaMock(fixtures: EmployeeFixtures): PrismaMock {
  const mock: PrismaMock = {
    hrisSyncRun: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    hrisSyncIssue: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    hrisDepartmentMap: {
      findUnique: jest.fn().mockResolvedValue({ hrisCode: 'ADMIN', departmentId: 'dept-1' }),
      create: jest.fn(),
    },
    hrisPositionMap: {
      findUnique: jest.fn().mockResolvedValue({ hrisCode: 'ITO', positionId: 'pos-1' }),
      create: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.hrisId === 'string') {
          return Promise.resolve(fixtures.linked[where.hrisId] ?? null);
        }
        if (where.workEmail) {
          const email = String(
            (where.workEmail as { equals?: string }).equals ?? where.workEmail,
          ).toLowerCase();
          return Promise.resolve(
            fixtures.emailHolders.some((held) => held.toLowerCase() === email)
              ? { id: 'emp-other' }
              : null,
          );
        }
        if (typeof where.employeeNumber === 'string') {
          return Promise.resolve(
            fixtures.numberHolders.includes(where.employeeNumber) ? { id: 'emp-other' } : null,
          );
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        // The missing-from-snapshot sweep: every row carrying an hrisId.
        if (where.hrisId && typeof where.hrisId === 'object') {
          return Promise.resolve(fixtures.linkedIndex);
        }
        // Initial-link candidates for one employee number.
        if (where.hrisId === null && typeof where.employeeNumber === 'string') {
          return Promise.resolve(fixtures.unlinkedByNumber[where.employeeNumber] ?? []);
        }
        return Promise.resolve([]);
      }),
      create: jest.fn().mockResolvedValue({ id: 'emp-new' }),
      update: jest.fn().mockResolvedValue({ id: 'emp-1' }),
    },
    asset: { count: jest.fn().mockResolvedValue(0) },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
    department: { findFirst: jest.fn().mockResolvedValue({ id: 'dept-1' }) },
    position: { findFirst: jest.fn().mockResolvedValue({ id: 'pos-1' }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    // The advisory lock is granted by default.
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: PrismaMock) => unknown)(mock)
      : Promise.all(arg as unknown[]),
  );
  return mock;
}

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

function snapshot(employees: HrisEmployee[] = [feed()]): HrisSnapshot {
  return {
    employees,
    companyCode: 'GEM',
    total: employees.length,
    pagesFetched: 1,
    generatedAt: '2026-10-21T01:30:00.000Z',
  };
}

function build(
  options: {
    snapshot?: HrisSnapshot;
    fetchError?: Error;
    fixtures?: EmployeeFixtures;
    /** GEMENI_HRIS_SYNC_ENABLED — "allowed to write", not "allowed to run". */
    enabled?: boolean;
  } = {},
) {
  const prisma = prismaMock(options.fixtures ?? emptyFixtures());
  const client = {
    fetchSnapshot: options.fetchError
      ? jest.fn().mockRejectedValue(options.fetchError)
      : jest.fn().mockResolvedValue(options.snapshot ?? snapshot()),
    probe: jest.fn(),
  };
  const notifications = { notify: jest.fn(), notifyMany: jest.fn() };
  const config = {
    hris: { defaultBranchCode: 'MNL', enabled: options.enabled ?? true },
  };
  const service = new HrisSyncService(
    prisma as unknown as never,
    config as unknown as never,
    client as unknown as never,
    notifications as unknown as never,
  );
  return { service, prisma, client, notifications };
}

/** The fields the run was finished with. */
function finishData(prisma: PrismaMock): Record<string, unknown> {
  const call = prisma.hrisSyncRun.update.mock.calls.at(-1);
  return (call?.[0] as { data: Record<string, unknown> }).data;
}

function issueCodes(prisma: PrismaMock): string[] {
  const call = prisma.hrisSyncIssue.createMany.mock.calls.at(-1);
  const data = (call?.[0] as { data: Array<{ code: string }> } | undefined)?.data ?? [];
  return data.map((issue) => issue.code);
}

describe('HrisSyncService.queueRun', () => {
  it('queues a run', async () => {
    const { service, prisma } = build();
    await service.queueRun({ trigger: HrisSyncTrigger.MANUAL, dryRun: false, requestedById: 'u-1' });
    expect(prisma.hrisSyncRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trigger: HrisSyncTrigger.MANUAL,
          dryRun: false,
          status: HrisSyncStatus.QUEUED,
          requestedById: 'u-1',
        }),
      }),
    );
  });

  /* An impatient double-click must not stack two reconciliations. */
  it('collapses onto a run that is already pending', async () => {
    const { service, prisma } = build();
    prisma.hrisSyncRun.findFirst.mockResolvedValue({ id: 'run-pending' });
    const result = await service.queueRun({ trigger: HrisSyncTrigger.MANUAL, dryRun: false });
    expect(result.id).toBe('run-pending');
    expect(prisma.hrisSyncRun.create).not.toHaveBeenCalled();
  });
});

describe('HrisSyncService.drainOnce', () => {
  it('does nothing when the advisory lock is held elsewhere', async () => {
    const { service, prisma, client } = build();
    prisma.$queryRaw.mockResolvedValue([{ locked: false }]);

    expect(await service.drainOnce()).toBeNull();
    expect(client.fetchSnapshot).not.toHaveBeenCalled();
    expect(prisma.hrisSyncRun.updateMany).not.toHaveBeenCalled();
  });

  it('releases the lock even when the run throws', async () => {
    const { service, prisma } = build();
    prisma.hrisSyncRun.findFirst.mockResolvedValue({ id: 'run-1', dryRun: false });
    prisma.hrisSyncRun.update.mockRejectedValue(new Error('db down'));

    await expect(service.drainOnce()).rejects.toThrow();
    // tryLock + unlock; the unlock is what keeps a crash from wedging the
    // integration until someone restarts the API.
    const statements = prisma.$queryRaw.mock.calls.map(() => true);
    expect(statements.length).toBeGreaterThanOrEqual(2);
  });

  it('returns null when nothing is queued', async () => {
    const { service, client } = build();
    expect(await service.drainOnce()).toBeNull();
    expect(client.fetchSnapshot).not.toHaveBeenCalled();
  });

  it('does not run a row another drain already claimed', async () => {
    const { service, prisma, client } = build();
    prisma.hrisSyncRun.findFirst.mockResolvedValue({ id: 'run-1', dryRun: false });
    prisma.hrisSyncRun.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.drainOnce()).toBeNull();
    expect(client.fetchSnapshot).not.toHaveBeenCalled();
  });
});

describe('a real run', () => {
  function queued(prisma: PrismaMock, dryRun = false) {
    prisma.hrisSyncRun.findFirst.mockImplementation(({ where }: { where: { status?: unknown } }) => {
      // queueRun's pending check vs. drainOnce's queued lookup use the same
      // method; only the latter should return the row.
      const status = JSON.stringify(where?.status ?? {});
      return Promise.resolve(
        status.includes('QUEUED') && !status.includes('RUNNING')
          ? { id: 'run-1', dryRun }
          : null,
      );
    });
  }

  it('creates an employee in the configured default branch', async () => {
    const { service, prisma } = build();
    queued(prisma);
    await service.drainOnce();

    expect(prisma.employee.create).toHaveBeenCalledTimes(1);
    const data = prisma.employee.create.mock.calls[0][0].data;
    expect(data.branchId).toBe('branch-1');
    expect(data.hrisId).toBe('hris-1');
    expect(data.displayName).toBe('Ana Reyes');
    expect(finishData(prisma).created).toBe(1);
  });

  it('skips creation when the configured branch is not active', async () => {
    const { service, prisma } = build();
    queued(prisma);
    prisma.branch.findFirst.mockResolvedValue(null);
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(issueCodes(prisma)).toContain(HRIS_ISSUE.noDefaultBranch);
    expect(finishData(prisma).status).toBe(HrisSyncStatus.REVIEW_REQUIRED);
  });

  it('skips a row whose department code is unmapped', async () => {
    const { service, prisma } = build();
    queued(prisma);
    prisma.hrisDepartmentMap.findUnique.mockResolvedValue({
      hrisCode: 'ADMIN',
      departmentId: null,
    });
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(issueCodes(prisma)).toContain(HRIS_ISSUE.unmappedDepartment);
  });

  /*
   * An employee record is what ties a missing laptop to a name. Deleting or
   * deactivating it to match the feed would erase the accountability trail at
   * exactly the moment it matters.
   */
  it('reports an employee missing from the snapshot without touching them', async () => {
    const { service, prisma } = build({
      fixtures: {
        ...emptyFixtures(),
        linkedIndex: [{ id: 'emp-gone', hrisId: 'hris-gone', employeeNumber: 'GC-0099' }],
      },
    });
    queued(prisma);
    await service.drainOnce();

    expect(issueCodes(prisma)).toContain(HRIS_ISSUE.missingFromSnapshot);
    // The only write is the newly created employee from the feed.
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(finishData(prisma).status).toBe(HrisSyncStatus.REVIEW_REQUIRED);
  });

  it('raises a clearance item when a separated employee still holds assets', async () => {
    const { service, prisma } = build({
      snapshot: snapshot([feed({ employmentStatus: 'RESIGNED' })]),
      fixtures: {
        ...emptyFixtures(),
        linked: { 'hris-1': employeeRow() },
        linkedIndex: [{ id: 'emp-1', hrisId: 'hris-1', employeeNumber: 'GC-0001' }],
      },
    });
    queued(prisma);
    prisma.asset.count.mockResolvedValue(3);
    await service.drainOnce();

    expect(prisma.employee.update).toHaveBeenCalledTimes(1);
    expect(issueCodes(prisma)).toContain(HRIS_ISSUE.inferredSeparationWithAssets);
  });
});

describe("what a sync must never touch", () => {
  function queuedReal(prisma: PrismaMock) {
    prisma.hrisSyncRun.findFirst.mockImplementation(
      ({ where }: { where: { status?: unknown } }) =>
        Promise.resolve(
          JSON.stringify(where?.status ?? {}).includes('RUNNING')
            ? null
            : { id: 'run-1', dryRun: false },
        ),
    );
  }

  /*
   * The written field set is the real control here. Asserting on it directly
   * means a future field added to the update cannot silently start
   * overwriting something GEM-ENI owns.
   */
  it('writes no GEM-ENI-owned field when updating', async () => {
    const { service, prisma } = build({
      snapshot: snapshot([feed({ firstName: 'Anna' })]),
      fixtures: { ...emptyFixtures(), linked: { 'hris-1': employeeRow() } },
    });
    queuedReal(prisma);
    await service.drainOnce();

    const data = prisma.employee.update.mock.calls[0][0].data as Record<string, unknown>;
    for (const field of [
      'branchId',
      'supervisorId',
      'userId',
      'notes',
      'photoUrl',
      'displayName',
      'archivedAt',
    ]) {
      expect(data).not.toHaveProperty(field);
    }
  });

  it('sets the branch only when creating, never on an update', async () => {
    const { service, prisma } = build({
      snapshot: snapshot([feed({ firstName: 'Anna' })]),
      fixtures: { ...emptyFixtures(), linked: { 'hris-1': employeeRow() } },
    });
    queuedReal(prisma);
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(prisma.employee.update.mock.calls[0][0].data).not.toHaveProperty('branchId');
  });

  /*
   * A nightly run over an unchanged roster must not bump the version and the
   * audit trail on every employee every night.
   */
  it('is idempotent over an unchanged snapshot', async () => {
    const { service, prisma } = build({
      fixtures: { ...emptyFixtures(), linked: { 'hris-1': employeeRow() } },
    });
    queuedReal(prisma);
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(finishData(prisma).unchanged).toBe(1);
    expect(finishData(prisma).status).toBe(HrisSyncStatus.SUCCEEDED);
  });

  /*
   * employeeNumber is mutable in the HRIS, so the match key is hrisId. A
   * renumbered person must update in place rather than appear as a new hire.
   */
  it('updates in place after the HRIS changes an employee number', async () => {
    const { service, prisma } = build({
      snapshot: snapshot([feed({ employeeNumber: 'GC-9999' })]),
      fixtures: { ...emptyFixtures(), linked: { 'hris-1': employeeRow() } },
    });
    queuedReal(prisma);
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(prisma.employee.update).toHaveBeenCalledTimes(1);
    expect(prisma.employee.update.mock.calls[0][0].where).toEqual({ id: 'emp-1' });
    expect(finishData(prisma).updated).toBe(1);
  });

  it('links one exact unlinked employee-number match', async () => {
    const { service, prisma } = build({
      fixtures: {
        ...emptyFixtures(),
        unlinkedByNumber: { 'GC-0001': [employeeRow({ hrisId: null })] },
      },
    });
    queuedReal(prisma);
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(finishData(prisma).linked).toBe(1);
  });

  /*
   * A near-match would attach one person's asset custody to another, and
   * rerunning the sync would not undo it.
   */
  it('refuses to choose between two unlinked employees with the same number', async () => {
    const { service, prisma } = build({
      fixtures: {
        ...emptyFixtures(),
        unlinkedByNumber: {
          'GC-0001': [
            employeeRow({ id: 'emp-a', hrisId: null }),
            employeeRow({ id: 'emp-b', hrisId: null }),
          ],
        },
      },
    });
    queuedReal(prisma);
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(issueCodes(prisma)).toContain(HRIS_ISSUE.ambiguousMatch);
  });

  it('never overwrites an email another employee holds', async () => {
    const { service, prisma } = build({
      snapshot: snapshot([feed({ workEmail: 'admin@gemcor.ph' })]),
      fixtures: { ...emptyFixtures(), emailHolders: ['admin@gemcor.ph'] },
    });
    queuedReal(prisma);
    await service.drainOnce();

    expect(prisma.employee.create.mock.calls[0][0].data.workEmail).toBeNull();
    expect(issueCodes(prisma)).toContain(HRIS_ISSUE.emailConflict);
  });
});

describe('a dry run', () => {
  function queuedDry(prisma: PrismaMock) {
    prisma.hrisSyncRun.findFirst.mockImplementation(
      ({ where }: { where: { status?: unknown } }) =>
        Promise.resolve(
          JSON.stringify(where?.status ?? {}).includes('RUNNING')
            ? null
            : { id: 'run-1', dryRun: true },
        ),
    );
  }

  /*
   * The single most important safety property: the rehearsal takes the same
   * decision path and changes no employee. A rehearsal that runs different
   * code proves nothing about the real run.
   */
  it('changes no employee, but still reports what it would have done', async () => {
    const { service, prisma } = build();
    queuedDry(prisma);
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(finishData(prisma).created).toBe(1);
  });

  /*
   * It does record the lookup codes it saw. Those are reference data, not
   * employee changes, and they are exactly what the review a dry run exists
   * to enable needs: without a mapping row there is nothing on the admin page
   * to point at a department, so a dry run reporting "unmapped" would be a
   * dead end with no way out but to enable writing.
   */
  it('records the department and position codes so they can be mapped', async () => {
    const { service, prisma } = build();
    queuedDry(prisma);
    prisma.hrisDepartmentMap.findUnique.mockResolvedValue(null);
    prisma.hrisPositionMap.findUnique.mockResolvedValue(null);
    prisma.hrisDepartmentMap.create.mockResolvedValue({ departmentId: 'dept-1' });
    prisma.hrisPositionMap.create.mockResolvedValue({ positionId: 'pos-1' });
    await service.drainOnce();

    expect(prisma.hrisDepartmentMap.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hrisCode: 'ADMIN', autoSuggested: true }),
      }),
    );
    expect(prisma.hrisPositionMap.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hrisCode: 'ITO', autoSuggested: true }),
      }),
    );
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });

  /* An unrecognised code is recorded unmapped, never pointed somewhere. */
  it('records an unmatched code with no target', async () => {
    const { service, prisma } = build();
    queuedDry(prisma);
    prisma.hrisDepartmentMap.findUnique.mockResolvedValue(null);
    prisma.department.findFirst.mockResolvedValue(null);
    prisma.hrisDepartmentMap.create.mockResolvedValue({ departmentId: null });
    await service.drainOnce();

    expect(prisma.hrisDepartmentMap.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ departmentId: null, autoSuggested: false }),
      }),
    );
    expect(issueCodes(prisma)).toContain(HRIS_ISSUE.unmappedDepartment);
  });
});

describe('while writing is disabled', () => {
  function queued(prisma: PrismaMock, dryRun: boolean) {
    prisma.hrisSyncRun.findFirst.mockImplementation(
      ({ where }: { where: { status?: unknown } }) =>
        Promise.resolve(
          JSON.stringify(where?.status ?? {}).includes('RUNNING')
            ? null
            : { id: 'run-1', dryRun },
        ),
    );
  }

  /*
   * The documented path is: deploy disabled, dry-run, review, then enable. So
   * a dry run has to execute while writing is off — otherwise the rehearsal
   * sits queued forever and the whole sequence is impossible.
   */
  it('still runs a dry run', async () => {
    const { service, prisma, client } = build({ enabled: false });
    queued(prisma, true);
    await service.drainOnce();

    expect(client.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(finishData(prisma).created).toBe(1);
    expect(finishData(prisma).status).toBe(HrisSyncStatus.SUCCEEDED);
  });

  /* Defence in depth: however a real run got queued, it must not write. */
  it('refuses a real run without even fetching', async () => {
    const { service, prisma, client } = build({ enabled: false });
    queued(prisma, false);
    await service.drainOnce();

    expect(client.fetchSnapshot).not.toHaveBeenCalled();
    expect(prisma.employee.create).not.toHaveBeenCalled();
    const data = finishData(prisma);
    expect(data.status).toBe(HrisSyncStatus.FAILED);
    expect(data.error).toMatch(/Writing is disabled/);
  });
});

describe('a failed fetch', () => {
  /*
   * Acting on half a snapshot would look exactly like a wave of departures,
   * so "apply nothing" is strictly correct here.
   */
  it('applies nothing and records the failure', async () => {
    const { service, prisma } = build({
      fetchError: new HrisTransportError('HRIS returned HTTP 503.', 503),
    });
    prisma.hrisSyncRun.findFirst.mockImplementation(({ where }: { where: { status?: unknown } }) =>
      Promise.resolve(
        JSON.stringify(where?.status ?? {}).includes('RUNNING')
          ? null
          : { id: 'run-1', dryRun: false },
      ),
    );
    await service.drainOnce();

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
    const data = finishData(prisma);
    expect(data.status).toBe(HrisSyncStatus.FAILED);
    expect(data.error).toMatch(/HTTP 503/);
  });

  it('notifies super admins', async () => {
    const { service, prisma, notifications } = build({
      fetchError: new HrisTransportError('nope'),
    });
    prisma.hrisSyncRun.findFirst.mockImplementation(({ where }: { where: { status?: unknown } }) =>
      Promise.resolve(
        JSON.stringify(where?.status ?? {}).includes('RUNNING')
          ? null
          : { id: 'run-1', dryRun: false },
      ),
    );
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
    await service.drainOnce();

    expect(notifications.notifyMany).toHaveBeenCalledWith(
      ['admin-1'],
      expect.objectContaining({ type: 'hris.sync_failed' }),
    );
  });
});
