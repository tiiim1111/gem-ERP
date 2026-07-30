import { HttpException } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { ScanService } from './scan.service';

/** Unit tests with mocked Prisma — no database. */

type MockFn = jest.Mock;

const VALID_TOKEN = 'q'.repeat(43); // base64url shape of a 32-byte token

function scanAssetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    assetTag: 'AST-SUB-LAP-2026-000001',
    serialNumber: 'SN-001',
    status: 'AVAILABLE',
    branchId: 'branch-1',
    item: { id: 'item-1', sku: 'SKU-LAP-00001', name: 'Dell Latitude', model: null },
    branch: { id: 'branch-1', code: 'SUB', name: 'GemCor - Subic' },
    warehouse: null,
    storageLocation: null,
    condition: { id: 'cond-1', code: 'GOOD', name: 'Good' },
    custodian: null,
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'u@x',
    displayName: 'User',
    isSuperAdmin: false,
    roles: [],
    permissions: ['asset.view', 'asset.assign'],
    branchIds: ['branch-1'],
    mustChangePassword: false,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

describe('ScanService', () => {
  let prisma: { asset: { findUnique: MockFn; findFirst: MockFn } };
  let itemBarcodes: { resolve: MockFn };
  let audit: { log: MockFn };
  let service: ScanService;

  beforeEach(() => {
    prisma = {
      asset: { findUnique: jest.fn(), findFirst: jest.fn() },
    };
    itemBarcodes = { resolve: jest.fn() };
    audit = { log: jest.fn() };
    service = new ScanService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      itemBarcodes as any,
    );
  });

  it('resolves an in-scope token to the asset summary + permitted actions', async () => {
    prisma.asset.findUnique.mockResolvedValue(scanAssetRow());

    const result = await service.resolveToken(makeUser(), VALID_TOKEN, {});

    expect(result.kind).toBe('asset');
    expect(result.id).toBe('asset-1');
    expect(result.summary.assetTag).toBe('AST-SUB-LAP-2026-000001');
    // branchId is internal — not part of the summary payload.
    expect('branchId' in result.summary).toBe(false);
    // asset.assign on an AVAILABLE asset → reserve + assign offered.
    expect(result.permittedActions).toEqual(['reserve', 'assign']);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scan.resolved', resourceId: 'asset-1' }),
    );
  });

  it('answers 404 SCAN_TOKEN_NOT_FOUND for a wrong-branch user (no oracle)', async () => {
    prisma.asset.findUnique.mockResolvedValue(
      scanAssetRow({ branchId: 'branch-OTHER' }),
    );
    let caught: unknown;
    try {
      await service.resolveToken(makeUser(), VALID_TOKEN, {});
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 404, 'SCAN_TOKEN_NOT_FOUND');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('answers the IDENTICAL 404 for an unknown token', async () => {
    prisma.asset.findUnique.mockResolvedValue(null);
    let caught: unknown;
    try {
      await service.resolveToken(makeUser(), VALID_TOKEN, {});
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 404, 'SCAN_TOKEN_NOT_FOUND');
  });

  it('rejects malformed tokens without querying the database', async () => {
    let caught: unknown;
    try {
      await service.resolveToken(makeUser(), 'nope', {});
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 404, 'SCAN_TOKEN_NOT_FOUND');
    expect(prisma.asset.findUnique).not.toHaveBeenCalled();
  });

  it('resolveCode routes a scanned QR URL through token resolution', async () => {
    prisma.asset.findUnique.mockResolvedValue(scanAssetRow());
    const result = await service.resolveCode(
      makeUser(),
      `http://localhost:3000/scan/${VALID_TOKEN}`,
      {},
    );
    expect(result.kind).toBe('asset');
    expect(prisma.asset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scanToken: VALID_TOKEN } }),
    );
  });

  it('resolveCode matches AST- prefixed asset tags, branch-scoped', async () => {
    prisma.asset.findUnique.mockResolvedValue(scanAssetRow());
    const result = await service.resolveCode(
      makeUser(),
      'ast-sub-lap-2026-000001',
      {},
    );
    expect(result.kind).toBe('asset');
    expect(prisma.asset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetTag: 'AST-SUB-LAP-2026-000001' },
      }),
    );

    // Same tag, wrong-branch user → behaves like an unknown code.
    prisma.asset.findUnique.mockResolvedValue(
      scanAssetRow({ branchId: 'branch-OTHER' }),
    );
    let caught: unknown;
    try {
      await service.resolveCode(makeUser(), 'AST-SUB-LAP-2026-000001', {});
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 404, 'NOT_FOUND');
  });

  it('resolveCode without the asset.view permission is 403', async () => {
    prisma.asset.findUnique.mockResolvedValue(scanAssetRow());
    let caught: unknown;
    try {
      await service.resolveCode(
        makeUser({ permissions: ['item.view'] }),
        'AST-SUB-LAP-2026-000001',
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 403, 'FORBIDDEN');
  });

  it('resolveCode falls back to the manufacturer serial after the item families', async () => {
    prisma.asset.findUnique.mockResolvedValue(null);
    // The catalog resolver's own 404 triggers the serial fallback.
    itemBarcodes.resolve.mockRejectedValue(
      new AppException(404, 'NOT_FOUND', 'no match'),
    );
    prisma.asset.findFirst.mockResolvedValue(scanAssetRow());

    const result = await service.resolveCode(makeUser(), 'SN-001', {});
    expect(result.kind).toBe('asset');
    expect(prisma.asset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serialNumber: 'SN-001' } }),
    );
  });

  it('resolveCode delegates item barcodes to the catalog resolver', async () => {
    itemBarcodes.resolve.mockResolvedValue({
      type: 'item',
      code: '0884116454501',
      item: { id: 'item-1', sku: 'SKU-LAP-00001', name: 'Dell' },
      mapping: null,
    });
    const result = await service.resolveCode(
      makeUser({ permissions: ['item.view'] }),
      '0884116454501',
      {},
    );
    expect(result.kind).toBe('item');
    expect(result.id).toBe('item-1');
  });
});
