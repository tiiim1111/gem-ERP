import { HrisAdminService } from './hris-admin.service';
import type { AuthUser } from '../../common/types/auth-request';

/*
 * Adopting the HRIS codes as GEM-ENI departments and positions.
 *
 * This is deliberately a separate action a person triggers, not something the
 * sync does: a nightly job that invents organisational records would turn a
 * typo upstream into a permanent junk department that other records then
 * reference. These tests pin that boundary.
 */

type MockFn = jest.Mock;

function build() {
  const prisma = {
    hrisDepartmentMap: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    hrisPositionMap: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    department: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    position: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
  } as unknown as Record<string, Record<string, MockFn>>;

  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new HrisAdminService(
    prisma as unknown as never,
    { hris: { enabled: false } } as unknown as never,
    { probe: jest.fn() } as unknown as never,
    { queueRun: jest.fn() } as unknown as never,
    audit as unknown as never,
  );
  return { service, prisma, audit };
}

const user = { id: 'admin-1' } as AuthUser;

/** mappings() is called at the end; give it empty lists after the writes. */
function stubFinalRead(prisma: Record<string, Record<string, MockFn>>) {
  prisma.hrisDepartmentMap.findMany.mockResolvedValueOnce([
    { id: 'dm-1', hrisCode: 'ADMIN', hrisName: null, departmentId: null, autoSuggested: false },
  ]);
  prisma.hrisPositionMap.findMany.mockResolvedValue([]);
  // Second call, from mappings().
  prisma.hrisDepartmentMap.findMany.mockResolvedValue([]);
}

describe('adoptUnmappedCodes', () => {
  it('creates a department for an unmapped code and points the mapping at it', async () => {
    const { service, prisma } = build();
    stubFinalRead(prisma);
    prisma.department.create.mockResolvedValue({ id: 'dept-new', code: 'ADMIN', name: 'ADMIN' });

    const result = await service.adoptUnmappedCodes(user);

    expect(prisma.department.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { code: 'ADMIN', name: 'ADMIN' } }),
    );
    expect(prisma.hrisDepartmentMap.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dm-1' },
        // A person decided, so the suggestion flag comes off.
        data: { departmentId: 'dept-new', autoSuggested: false },
      }),
    );
    expect(result.createdDepartments).toEqual(['ADMIN']);
  });

  /*
   * The feed carries codes but no names, by design — a name that drifts
   * upstream would look like a new department. So the code becomes the name
   * and the operator renames it if they want.
   */
  it('names the record after the code when the feed gave no name', async () => {
    const { service, prisma } = build();
    stubFinalRead(prisma);
    prisma.department.create.mockResolvedValue({ id: 'dept-new', code: 'ADMIN', name: 'ADMIN' });

    await service.adoptUnmappedCodes(user);

    expect(prisma.department.create.mock.calls[0][0].data.name).toBe('ADMIN');
  });

  /*
   * Codes are globally unique, so creating one that already exists would
   * collide. Pointing at it is right; silently reactivating somebody's
   * archived record is not this action's call.
   */
  it('links an existing code instead of creating a duplicate', async () => {
    const { service, prisma } = build();
    stubFinalRead(prisma);
    prisma.department.findUnique.mockResolvedValue({
      id: 'dept-existing',
      isActive: true,
      archivedAt: null,
    });

    const result = await service.adoptUnmappedCodes(user);

    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.hrisDepartmentMap.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { departmentId: 'dept-existing', autoSuggested: false } }),
    );
    expect(result.createdDepartments).toEqual([]);
    expect(result.linkedExisting).toEqual(['department ADMIN']);
  });

  it('says so when the existing record is inactive', async () => {
    const { service, prisma } = build();
    stubFinalRead(prisma);
    prisma.department.findUnique.mockResolvedValue({
      id: 'dept-old',
      isActive: false,
      archivedAt: null,
    });

    const result = await service.adoptUnmappedCodes(user);

    expect(result.linkedExisting[0]).toMatch(/inactive/);
  });

  it('audits each created record and the action itself', async () => {
    const { service, prisma, audit } = build();
    stubFinalRead(prisma);
    prisma.department.create.mockResolvedValue({ id: 'dept-new', code: 'ADMIN', name: 'ADMIN' });

    await service.adoptUnmappedCodes(user);

    const actions = audit.log.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions).toContain('department.created');
    expect(actions).toContain('hris.codes_adopted');
    // Attributed to the person who pressed it, not to the system.
    expect((audit.log.mock.calls[0][0] as { actor: string }).actor).toBe('admin-1');
  });

  it('does nothing when every code is already mapped', async () => {
    const { service, prisma } = build();
    prisma.hrisDepartmentMap.findMany.mockResolvedValue([]);
    prisma.hrisPositionMap.findMany.mockResolvedValue([]);

    const result = await service.adoptUnmappedCodes(user);

    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.position.create).not.toHaveBeenCalled();
    expect(result.createdDepartments).toEqual([]);
    expect(result.createdPositions).toEqual([]);
  });
});
