import { HttpException } from '@nestjs/common';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { EmployeesService } from './employees.service';

/**
 * Unit tests with a fully mocked Prisma client — no database. Covers the
 * Phase 2 business rules: optimistic-version rejection, employee-number
 * generation, and the separation-blocks-archive workflow.
 */

type MockFn = jest.Mock;

interface PrismaMock {
  employee: {
    findUnique: MockFn;
    findMany: MockFn;
    count: MockFn;
    create: MockFn;
    update: MockFn;
    updateMany: MockFn;
  };
  asset: { findMany: MockFn };
  branch: { findUnique: MockFn };
  department: { findUnique: MockFn };
  position: { findUnique: MockFn };
  user: { findUnique: MockFn };
  $transaction: MockFn;
}

function prismaMock(): PrismaMock {
  return {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    asset: { findMany: jest.fn() },
    branch: { findUnique: jest.fn() },
    department: { findUnique: jest.fn() },
    position: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
}

const superAdmin = {
  id: 'admin-1',
  email: 'admin@x',
  displayName: 'Admin',
  isSuperAdmin: true,
  roles: [],
  permissions: [],
  branchIds: [],
  mustChangePassword: false,
};

function employeeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'emp-1',
    employeeNumber: 'EMP-000001',
    firstName: 'Maria',
    middleName: null,
    lastName: 'Santos',
    displayName: null,
    workEmail: null,
    workPhone: null,
    status: 'ACTIVE',
    startDate: null,
    separationDate: null,
    photoUrl: null,
    notes: null,
    version: 1,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    branch: { id: 'branch-1', code: 'SUB', name: 'Subic' },
    department: null,
    position: null,
    supervisor: null,
    user: null,
    ...overrides,
  };
}

function expectAppError(
  error: unknown,
  status: number,
  code: string,
): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

describe('EmployeesService', () => {
  let prisma: PrismaMock;
  let audit: { log: MockFn };
  let sequences: { next: MockFn };
  let service: EmployeesService;

  beforeEach(() => {
    prisma = prismaMock();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    sequences = { next: jest.fn() };
    service = new EmployeesService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
    );
  });

  describe('update — optimistic concurrency', () => {
    it('rejects a stale version with 409 VERSION_CONFLICT', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeRow({ version: 3 }));
      // updateMany touches 0 rows when the version predicate misses.
      prisma.employee.updateMany.mockResolvedValue({ count: 0 });

      let caught: unknown;
      try {
        await service.update(
          superAdmin,
          'emp-1',
          { version: 2, firstName: 'Marie' },
          {},
        );
      } catch (error) {
        caught = error;
      }
      expectAppError(caught, 409, 'VERSION_CONFLICT');
      expect(prisma.employee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'emp-1', version: 2 } }),
      );
    });

    it('applies the update and bumps the version when it matches', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeRow({ version: 2 }));
      prisma.employee.updateMany.mockResolvedValue({ count: 1 });

      await service.update(
        superAdmin,
        'emp-1',
        { version: 2, firstName: 'Marie' },
        {},
      );
      expect(prisma.employee.updateMany).toHaveBeenCalledWith({
        where: { id: 'emp-1', version: 2 },
        data: expect.objectContaining({
          firstName: 'Marie',
          version: { increment: 1 },
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'employee.updated' }),
      );
    });
  });

  describe('create — employee number generation', () => {
    it('generates EMP-{SEQ6} from sequence_counters when omitted', async () => {
      prisma.branch.findUnique.mockResolvedValue({ id: 'branch-1' });
      const txEmployeeCreate = jest
        .fn()
        .mockResolvedValue(employeeRow({ employeeNumber: 'EMP-000007' }));
      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({ employee: { create: txEmployeeCreate } }),
      );
      sequences.next.mockResolvedValue(7);

      await service.create(
        superAdmin,
        { firstName: 'Ana', lastName: 'Cruz', branchId: 'branch-1' },
        {},
      );
      expect(sequences.next).toHaveBeenCalledWith(expect.anything(), 'EMP');
      expect(txEmployeeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employeeNumber: 'EMP-000007' }),
        }),
      );
    });

    it('rejects an explicitly provided duplicate number with 409', async () => {
      prisma.branch.findUnique.mockResolvedValue({ id: 'branch-1' });
      prisma.employee.findUnique.mockResolvedValue({ id: 'other' });

      let caught: unknown;
      try {
        await service.create(
          superAdmin,
          {
            firstName: 'Ana',
            lastName: 'Cruz',
            branchId: 'branch-1',
            employeeNumber: 'EMP-000001',
          },
          {},
        );
      } catch (error) {
        caught = error;
      }
      expectAppError(caught, 409, 'DUPLICATE_CODE');
    });
  });

  describe('separation and archival', () => {
    it('separate returns the outstanding assigned assets', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeRow());
      prisma.employee.update.mockResolvedValue(
        employeeRow({ status: 'SEPARATED', separationDate: new Date('2026-08-31') }),
      );
      const outstanding = [
        {
          id: 'asset-1',
          assetTag: 'AST-SUB-LAP-2026-000001',
          serialNumber: 'SN1',
          status: 'ASSIGNED',
          item: { id: 'item-1', sku: 'SKU-LAP-00001', name: 'Laptop' },
        },
      ];
      prisma.asset.findMany.mockResolvedValue(outstanding);

      const result = await service.separate(
        superAdmin,
        'emp-1',
        { separationDate: '2026-08-31' },
        {},
      );
      expect(result.outstandingAssets).toEqual(outstanding);
      expect(result.employee.status).toBe('SEPARATED');
    });

    it('blocks archive while the employee is not separated', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeRow({ status: 'ACTIVE' }));

      let caught: unknown;
      try {
        await service.archive(superAdmin, 'emp-1', {});
      } catch (error) {
        caught = error;
      }
      expectAppError(caught, 409, 'INVALID_STATE_TRANSITION');
    });

    it('blocks archive while assets remain in custody (never auto-returned)', async () => {
      prisma.employee.findUnique.mockResolvedValue(
        employeeRow({ status: 'SEPARATED' }),
      );
      prisma.asset.findMany.mockResolvedValue([
        {
          id: 'asset-1',
          assetTag: 'AST-SUB-LAP-2026-000001',
          serialNumber: null,
          status: 'ASSIGNED',
          item: { id: 'item-1', sku: 'SKU-LAP-00001', name: 'Laptop' },
        },
      ]);

      let caught: unknown;
      try {
        await service.archive(superAdmin, 'emp-1', {});
      } catch (error) {
        caught = error;
      }
      expectAppError(caught, 409, 'INVALID_STATE_TRANSITION');
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('archives a separated employee with clean custody', async () => {
      prisma.employee.findUnique.mockResolvedValue(
        employeeRow({ status: 'SEPARATED' }),
      );
      prisma.asset.findMany.mockResolvedValue([]);
      prisma.employee.update.mockResolvedValue(
        employeeRow({ status: 'SEPARATED', archivedAt: new Date() }),
      );

      await service.archive(superAdmin, 'emp-1', {});
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            archivedAt: expect.any(Date),
            version: { increment: 1 },
          }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'employee.archived' }),
      );
    });
  });

  describe('branch scoping', () => {
    it('returns 404 for an out-of-scope employee (no existence leak)', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeRow());
      const scopedUser = { ...superAdmin, isSuperAdmin: false, branchIds: ['other'] };

      let caught: unknown;
      try {
        await service.getById(scopedUser, 'emp-1');
      } catch (error) {
        caught = error;
      }
      expectAppError(caught, 404, 'NOT_FOUND');
    });
  });

  describe('restricted notes', () => {
    it('omits notes without employee.view_notes and includes them with it', async () => {
      prisma.employee.findUnique.mockResolvedValue(
        employeeRow({ notes: 'sensitive' }),
      );
      const plainUser = {
        ...superAdmin,
        isSuperAdmin: false,
        branchIds: ['branch-1'],
        permissions: ['employee.view'],
      };
      const withoutNotes = await service.getById(plainUser, 'emp-1');
      expect('notes' in withoutNotes).toBe(false);

      const withNotes = await service.getById(
        { ...plainUser, permissions: ['employee.view', 'employee.view_notes'] },
        'emp-1',
      );
      expect(withNotes.notes).toBe('sensitive');
    });
  });
});
