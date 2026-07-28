import { HttpException } from '@nestjs/common';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { ItemBarcodesService } from './item-barcodes.service';
import { ItemsService } from './items.service';

/** Unit tests with mocked Prisma — no database. */

type MockFn = jest.Mock;

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

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sku: 'SKU-OFC-00001',
    name: 'Bond Paper A4',
    description: null,
    businessCategory: 'CONSUMABLE',
    trackingMethod: 'QUANTITY',
    categoryId: null,
    subcategoryId: null,
    brandId: null,
    manufacturerId: null,
    model: null,
    baseUomId: 'uom-1',
    purchaseUomId: null,
    issueUomId: null,
    defaultSupplierId: null,
    standardCost: null,
    lastPurchaseCost: null,
    isLotTracked: false,
    isExpiryTracked: false,
    requiresSerialNumber: false,
    isMaintainable: false,
    isActive: true,
    version: 1,
    archivedAt: null,
    ...overrides,
  };
}

describe('ItemsService', () => {
  let prisma: {
    item: {
      findUnique: MockFn;
      findMany: MockFn;
      count: MockFn;
      updateMany: MockFn;
      update: MockFn;
    };
  };
  let service: ItemsService;

  beforeEach(() => {
    prisma = {
      item: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new ItemsService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: jest.fn() } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { next: jest.fn() } as any,
    );
  });

  it('rejects a stale version with 409 VERSION_CONFLICT', async () => {
    prisma.item.findUnique.mockResolvedValue(itemRow({ version: 4 }));
    prisma.item.updateMany.mockResolvedValue({ count: 0 });

    let caught: unknown;
    try {
      await service.update(superAdmin, 'item-1', { version: 3, name: 'New name' }, {});
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 409, 'VERSION_CONFLICT');
    expect(prisma.item.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-1', version: 3 } }),
    );
  });

  it('blocks trackingMethod changes once stock or assets exist', async () => {
    prisma.item.findUnique
      // requireItem
      .mockResolvedValueOnce(itemRow())
      // usageCount — one ledger entry pins the classification
      .mockResolvedValueOnce({
        _count: {
          assets: 0,
          stockTransactionLines: 0,
          stockLedgerEntries: 1,
          stockBalances: 0,
          lots: 0,
        },
      });

    let caught: unknown;
    try {
      await service.update(
        superAdmin,
        'item-1',
        { version: 1, trackingMethod: 'LOT' },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 409, 'INVALID_STATE_TRANSITION');
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a disallowed businessCategory/trackingMethod combo', async () => {
    prisma.item.findUnique.mockResolvedValueOnce(
      itemRow({ businessCategory: 'SERIALIZED_ASSET', trackingMethod: 'SERIAL' }),
    );

    let caught: unknown;
    try {
      await service.update(
        superAdmin,
        'item-1',
        { version: 1, trackingMethod: 'QUANTITY' },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 400, 'VALIDATION_ERROR');
  });
});

describe('ItemBarcodesService', () => {
  let prisma: {
    item: { findUnique: MockFn };
    itemBarcode: {
      findFirst: MockFn;
      findUnique: MockFn;
      findMany: MockFn;
      create: MockFn;
      update: MockFn;
      updateMany: MockFn;
    };
    unitOfMeasure: { findUnique: MockFn };
    $transaction: MockFn;
  };
  let service: ItemBarcodesService;

  beforeEach(() => {
    prisma = {
      item: { findUnique: jest.fn() },
      itemBarcode: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      unitOfMeasure: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new ItemBarcodesService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: jest.fn() } as any,
    );
  });

  it('rejects a barcode with an ACTIVE mapping on another item (409 DUPLICATE_CODE)', async () => {
    prisma.item.findUnique.mockResolvedValue({ id: 'item-1', sku: 'SKU-OFC-00001' });
    prisma.itemBarcode.findFirst.mockResolvedValue({
      itemId: 'item-2',
      item: { sku: 'SKU-OFC-00002' },
    });

    let caught: unknown;
    try {
      await service.addToItem('item-1', { barcode: '4800000000001' }, {});
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 409, 'DUPLICATE_CODE');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows re-adding a barcode whose previous mapping was archived', async () => {
    prisma.item.findUnique.mockResolvedValue({ id: 'item-1', sku: 'SKU-OFC-00001' });
    // No ACTIVE mapping exists (the archived one has active=NULL).
    prisma.itemBarcode.findFirst.mockResolvedValue(null);
    const txCreate = jest.fn().mockResolvedValue({
      id: 'bc-1',
      itemId: 'item-1',
      barcode: '4800000000001',
      barcodeType: 'SUPPLIER',
      isPrimary: false,
      active: true,
      deactivatedAt: null,
      createdAt: new Date(),
      uom: null,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ itemBarcode: { create: txCreate, updateMany: jest.fn() } }),
    );

    const created = await service.addToItem(
      'item-1',
      { barcode: '4800000000001' },
      {},
    );
    expect(created.barcode).toBe('4800000000001');
    expect(txCreate).toHaveBeenCalled();
  });

  it('archives a mapping by nulling active (unique-while-active pattern)', async () => {
    prisma.item.findUnique.mockResolvedValue({ id: 'item-1', sku: 'SKU-OFC-00001' });
    prisma.itemBarcode.findUnique.mockResolvedValue({
      id: 'bc-1',
      itemId: 'item-1',
      barcode: '4800000000001',
      active: true,
    });
    prisma.itemBarcode.update.mockResolvedValue({});

    await service.archive('item-1', 'bc-1', {});
    expect(prisma.itemBarcode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ active: null, isPrimary: false }),
      }),
    );
  });
});
