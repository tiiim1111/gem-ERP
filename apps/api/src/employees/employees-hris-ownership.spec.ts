import { EmployeeStatus } from '@prisma/client';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { EmployeesService } from './employees.service';
import type { AuthUser } from '../common/types/auth-request';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';

/*
 * Server-side enforcement of HRIS field ownership.
 *
 * A disabled form input is a courtesy, not a control: anything reachable over
 * the API has to refuse here too. And an edit that survives only until the
 * next sync silently reverts it is worse than a clear refusal, which is why
 * these are rejections rather than "last writer wins".
 */

const superAdmin: AuthUser = {
  id: 'admin-1',
  email: 'admin@gemcor.ph',
  displayName: 'Admin',
  isSuperAdmin: true,
  roles: [],
  permissions: [],
  branchIds: [],
} as unknown as AuthUser;

function employeeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'emp-1',
    employeeNumber: 'GC-0001',
    firstName: 'Ana',
    middleName: null,
    lastName: 'Reyes',
    displayName: 'Ana Reyes',
    workEmail: null,
    workPhone: null,
    status: EmployeeStatus.ACTIVE,
    startDate: null,
    separationDate: null,
    photoUrl: null,
    notes: null,
    version: 1,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    hrisId: 'hris-1',
    hrisSyncedAt: new Date(),
    separationDateInferred: false,
    branch: { id: 'branch-1', code: 'MNL', name: 'Manila' },
    department: { id: 'dept-1', code: 'ADMIN', name: 'Administration' },
    position: { id: 'pos-1', code: 'ITO', name: 'IT Officer' },
    supervisor: null,
    user: null,
    ...overrides,
  };
}

function build(options: { row?: Record<string, unknown>; syncEnabled?: boolean } = {}) {
  const prisma = {
    employee: {
      findUnique: jest.fn().mockResolvedValue(options.row ?? employeeRow()),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue(employeeRow()),
      // The versioned update path goes through updateMany and checks count.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    asset: { findMany: jest.fn().mockResolvedValue([]) },
    branch: { findUnique: jest.fn().mockResolvedValue({ id: 'branch-1', isActive: true }) },
    department: { findUnique: jest.fn() },
    position: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new EmployeesService(
    prisma as unknown as never,
    new BranchScopeService(),
    { log: jest.fn().mockResolvedValue(undefined) } as unknown as never,
    { next: jest.fn() } as unknown as never,
    { hris: { enabled: options.syncEnabled ?? false } } as unknown as never,
  );
  return { service, prisma };
}

const ctx = { ip: '127.0.0.1', userAgent: 'test', correlationId: 'c-1' } as never;
const dto = (fields: Partial<UpdateEmployeeDto>) => ({ version: 1, ...fields }) as UpdateEmployeeDto;

/**
 * AppException keeps its text in the response envelope, not in `.message`
 * (which is always "App Exception"), so assertions read the envelope.
 */
async function envelopeOf(
  call: Promise<unknown>,
): Promise<{ code: string; message: string; details?: Array<{ field: string }> }> {
  try {
    await call;
  } catch (caught) {
    const response = (caught as { getResponse?: () => unknown }).getResponse?.();
    const error = (response as { error?: Record<string, unknown> } | undefined)?.error;
    if (error) {
      return error as { code: string; message: string; details?: Array<{ field: string }> };
    }
    throw caught;
  }
  throw new Error('expected the call to be refused, but it succeeded');
}

describe('HRIS-owned fields on a linked employee', () => {
  it.each([
    ['employeeNumber', { employeeNumber: 'GC-9999' }],
    ['firstName', { firstName: 'Anna' }],
    ['middleName', { middleName: 'Santos' }],
    ['lastName', { lastName: 'Cruz' }],
    ['workEmail', { workEmail: 'anna@gemcor.ph' }],
    ['departmentId', { departmentId: '11111111-1111-4111-8111-111111111111' }],
    ['positionId', { positionId: '22222222-2222-4222-8222-222222222222' }],
    ['startDate', { startDate: '2024-01-01' }],
    ['separationDate', { separationDate: '2026-01-01' }],
  ])('refuses an edit to %s', async (_label, fields) => {
    const { service, prisma } = build();
    const error = await envelopeOf(
      service.update(superAdmin, 'emp-1', dto(fields as Partial<UpdateEmployeeDto>), ctx),
    );
    expect(error.message).toMatch(/comes from the HRIS/);
    // updateMany is the versioned write path — the one a failed guard would hit.
    expect(prisma.employee.updateMany).not.toHaveBeenCalled();
  });

  it('names every refused field so the UI can mark them', async () => {
    const { service } = build();
    const error = await envelopeOf(
      service.update(superAdmin, 'emp-1', dto({ firstName: 'Anna', workEmail: 'a@b.c' }), ctx),
    );
    expect((error.details ?? []).map((detail) => detail.field).sort()).toEqual([
      'firstName',
      'workEmail',
    ]);
  });

  /*
   * The other half of the contract: GEM-ENI keeps owning what the HRIS has no
   * source for, so those edits must still go through on a linked employee.
   */
  it.each([
    ['workPhone', { workPhone: '+63 2 8123 4567' }],
    ['notes', { notes: 'Holds the server-room key' }],
  ])('still allows an edit to %s', async (_label, fields) => {
    const { service, prisma } = build();
    await service.update(superAdmin, 'emp-1', dto(fields as Partial<UpdateEmployeeDto>), ctx);
    expect(prisma.employee.updateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves an unlinked employee fully editable', async () => {
    const { service, prisma } = build({ row: employeeRow({ hrisId: null }) });
    await service.update(superAdmin, 'emp-1', dto({ firstName: 'Anna' }), ctx);
    expect(prisma.employee.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('status transitions on a linked employee', () => {
  /*
   * Status is HRIS-owned, so a manual change here would be reverted by the
   * next sync — a confusing outcome the refusal avoids.
   */
  it.each([['activate'], ['deactivate'], ['separate']] as const)(
    'refuses %s',
    async (action) => {
      const { service, prisma } = build();
      const call =
        action === 'separate'
          ? service.separate(superAdmin, 'emp-1', { separationDate: '2026-10-21' } as never, ctx)
          : action === 'activate'
            ? service.activate(superAdmin, 'emp-1', ctx)
            : service.deactivate(superAdmin, 'emp-1', {} as never, ctx);
      const error = await envelopeOf(call);
      expect(error.message).toMatch(/status comes from the HRIS/);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    },
  );

  it('allows them on an unlinked employee', async () => {
    const { service, prisma } = build({ row: employeeRow({ hrisId: null }) });
    await service.activate(superAdmin, 'emp-1', ctx);
    expect(prisma.employee.update).toHaveBeenCalledTimes(1);
  });
});

describe('manual creation once the feed is live', () => {
  /*
   * With the HRIS as the system of record, a hand-made employee is either a
   * duplicate or about to be overwritten. Blocked server-side, not only hidden
   * in the UI.
   */
  it('is refused while the sync is enabled', async () => {
    const { service, prisma } = build({ syncEnabled: true });
    const error = await envelopeOf(
      service.create(superAdmin, { firstName: 'Ana', lastName: 'Reyes' } as never, ctx),
    );
    expect(error.message).toMatch(/Employees come from the HRIS/);
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });

  it('is allowed while the sync is off', async () => {
    const { service, prisma } = build({ syncEnabled: false });
    await service
      .create(superAdmin, { firstName: 'Ana', lastName: 'Reyes', branchId: 'branch-1' } as never, ctx)
      .catch(() => undefined);
    // It got past the guard — whether it then succeeds is the existing suite's
    // business, not this file's.
    expect(prisma.branch.findUnique).toHaveBeenCalled();
  });
});
