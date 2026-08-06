import { HttpException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { AttachmentsService } from './attachments.service';
import type { AttachmentStorageService } from './attachment-storage.service';
import { AppException } from '../common/errors/app.exception';

/**
 * Unit tests with fully mocked Prisma and object storage — no database, no
 * MinIO. Covers the §4.6 contract: parent-based authorization (permission +
 * branch scope, 404 no-leak), file type/size validation, the S3_ENABLED=false
 * graceful 503, soft archive rules (uploader OR parent-update permission),
 * and that the storage key never leaks in views.
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    attachment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    asset: { findUnique: jest.fn() },
    item: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    purchaseOrder: { findUnique: jest.fn() },
    goodsReceipt: { findUnique: jest.fn() },
    maintenanceWorkOrder: { findUnique: jest.fn() },
    transfer: { findUnique: jest.fn() },
    assetAssignment: { findUnique: jest.fn() },
    stockTransaction: { findUnique: jest.fn() },
    lookupValue: { findUnique: jest.fn() },
  };
}

function storageMock() {
  return {
    isEnabled: true,
    assertEnabled: jest.fn(),
    put: jest.fn().mockResolvedValue(undefined),
    getStream: jest.fn(),
    deleteQuietly: jest.fn().mockResolvedValue(undefined),
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

/** Branch-1 user holding asset view+update (typical asset custodian). */
const custodian = {
  ...superAdmin,
  id: 'user-2',
  isSuperAdmin: false,
  permissions: ['asset.view', 'asset.update'],
  branchIds: ['branch-1'],
};

/** Branch-1 user with view-only rights on assets. */
const viewer = {
  ...superAdmin,
  id: 'user-3',
  isSuperAdmin: false,
  permissions: ['asset.view'],
  branchIds: ['branch-1'],
};

const pdfFile = {
  originalName: 'warranty card.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 fake'),
};

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-1',
    resourceType: 'asset',
    resourceId: 'asset-1',
    fileName: 'warranty card.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 13,
    storageKey: 'asset/asset-1/uuid.pdf',
    checksum: 'abc',
    branchId: 'branch-1',
    archivedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    documentType: null,
    uploadedBy: { id: 'user-2', displayName: 'Custodian', email: 'c@x' },
    ...overrides,
  };
}

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

interface Mocks {
  prisma: ReturnType<typeof prismaMock>;
  storage: ReturnType<typeof storageMock>;
  audit: { log: MockFn };
}

function makeService(mocks: Mocks): AttachmentsService {
  return new AttachmentsService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.prisma as any,
    mocks.storage as unknown as AttachmentStorageService,
    new BranchScopeService(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.audit as any,
  );
}

function makeMocks(): Mocks {
  return {
    prisma: prismaMock(),
    storage: storageMock(),
    audit: { log: jest.fn().mockResolvedValue(undefined) },
  };
}

describe('AttachmentsService.upload', () => {
  let mocks: Mocks;
  let service: AttachmentsService;

  beforeEach(() => {
    mocks = makeMocks();
    service = makeService(mocks);
    mocks.prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      branchId: 'branch-1',
      assetTag: 'AST-1',
    });
    mocks.prisma.attachment.create.mockResolvedValue(attachmentRow());
  });

  it('uploads to storage, writes metadata, and audits (asset parent)', async () => {
    const view = await service.upload(
      custodian,
      { resourceType: 'asset', resourceId: 'asset-1' },
      pdfFile,
      {},
    );

    expect(mocks.storage.put).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = mocks.storage.put.mock.calls[0];
    expect(key).toMatch(/^asset\/asset-1\/[0-9a-f-]{36}\.pdf$/);
    expect(body).toBe(pdfFile.buffer);
    expect(contentType).toBe('application/pdf');

    expect(mocks.prisma.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceType: 'asset',
          resourceId: 'asset-1',
          branchId: 'branch-1',
          uploadedById: 'user-2',
          sizeBytes: pdfFile.buffer.length,
          checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attachment.uploaded' }),
    );
    // The storage key never leaves the API.
    expect('storageKey' in (view as unknown as Record<string, unknown>)).toBe(
      false,
    );
  });

  it('fails 503 SERVICE_DISABLED without object storage (S3_ENABLED=false)', async () => {
    mocks.storage.assertEnabled.mockImplementation(() => {
      throw new AppException(503, 'SERVICE_DISABLED', 'no storage');
    });
    const error = await catchError(
      service.upload(
        custodian,
        { resourceType: 'asset', resourceId: 'asset-1' },
        pdfFile,
        {},
      ),
    );
    expectAppError(error, 503, 'SERVICE_DISABLED');
    expect(mocks.storage.put).not.toHaveBeenCalled();
    expect(mocks.prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('rejects a disallowed extension and a mismatched MIME type', async () => {
    const exe = await catchError(
      service.upload(
        custodian,
        { resourceType: 'asset', resourceId: 'asset-1' },
        { ...pdfFile, originalName: 'virus.exe' },
        {},
      ),
    );
    expectAppError(exe, 400, 'VALIDATION_ERROR');

    const mismatched = await catchError(
      service.upload(
        custodian,
        { resourceType: 'asset', resourceId: 'asset-1' },
        { ...pdfFile, mimeType: 'application/x-msdownload' },
        {},
      ),
    );
    expectAppError(mismatched, 400, 'VALIDATION_ERROR');
    expect(mocks.storage.put).not.toHaveBeenCalled();
  });

  it('404s (no leak) when the parent is outside the caller branches', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      branchId: 'branch-2',
      assetTag: 'AST-1',
    });
    const error = await catchError(
      service.upload(
        custodian,
        { resourceType: 'asset', resourceId: 'asset-1' },
        pdfFile,
        {},
      ),
    );
    expectAppError(error, 404, 'NOT_FOUND');
  });

  it('403s without the parent update-permission', async () => {
    const error = await catchError(
      service.upload(
        viewer,
        { resourceType: 'asset', resourceId: 'asset-1' },
        pdfFile,
        {},
      ),
    );
    expectAppError(error, 403, 'FORBIDDEN');
    expect(mocks.storage.put).not.toHaveBeenCalled();
  });

  it('validates documentTypeId against active DOCUMENT_TYPE lookups', async () => {
    mocks.prisma.lookupValue.findUnique.mockResolvedValue({
      id: 'lv-1',
      category: 'ASSET_CONDITION',
      isActive: true,
    });
    const error = await catchError(
      service.upload(
        custodian,
        {
          resourceType: 'asset',
          resourceId: 'asset-1',
          documentTypeId: 'lv-1',
        },
        pdfFile,
        {},
      ),
    );
    expectAppError(error, 400, 'VALIDATION_ERROR');
  });

  it('rolls the object back when the metadata write fails', async () => {
    mocks.prisma.attachment.create.mockRejectedValue(new Error('db down'));
    const error = await catchError(
      service.upload(
        custodian,
        { resourceType: 'asset', resourceId: 'asset-1' },
        pdfFile,
        {},
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect(mocks.storage.deleteQuietly).toHaveBeenCalledTimes(1);
  });
});

describe('AttachmentsService.list / download', () => {
  let mocks: Mocks;
  let service: AttachmentsService;

  beforeEach(() => {
    mocks = makeMocks();
    service = makeService(mocks);
    mocks.prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      branchId: 'branch-1',
      assetTag: 'AST-1',
    });
  });

  it('lists a parent record attachments as {data, meta} views', async () => {
    mocks.prisma.attachment.findMany.mockResolvedValue([attachmentRow()]);
    mocks.prisma.attachment.count.mockResolvedValue(1);

    const result = await service.list(viewer, {
      resourceType: 'asset',
      resourceId: 'asset-1',
    });
    expect(result.meta.total).toBe(1);
    expect(result.data[0].fileName).toBe('warranty card.pdf');
    expect(
      'storageKey' in (result.data[0] as unknown as Record<string, unknown>),
    ).toBe(false);
    expect(mocks.prisma.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: null }),
      }),
    );
  });

  it('403s the list without the parent view-permission', async () => {
    const stranger = { ...viewer, permissions: [] };
    const error = await catchError(
      service.list(stranger, { resourceType: 'asset', resourceId: 'asset-1' }),
    );
    expectAppError(error, 403, 'FORBIDDEN');
  });

  it('streams a download after re-authorizing against the parent', async () => {
    mocks.prisma.attachment.findUnique.mockResolvedValue(attachmentRow());
    mocks.storage.getStream.mockResolvedValue({
      body: Readable.from(Buffer.from('bytes')),
      contentLength: 5,
    });

    const download = await service.download(viewer, 'att-1');
    expect(download.fileName).toBe('warranty card.pdf');
    expect(download.mimeType).toBe('application/pdf');
    expect(mocks.storage.getStream).toHaveBeenCalledWith(
      'asset/asset-1/uuid.pdf',
    );
  });

  it('404s downloads of archived attachments', async () => {
    mocks.prisma.attachment.findUnique.mockResolvedValue(
      attachmentRow({ archivedAt: new Date() }),
    );
    const error = await catchError(service.download(viewer, 'att-1'));
    expectAppError(error, 404, 'NOT_FOUND');
  });
});

describe('AttachmentsService.archive', () => {
  let mocks: Mocks;
  let service: AttachmentsService;

  beforeEach(() => {
    mocks = makeMocks();
    service = makeService(mocks);
    mocks.prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      branchId: 'branch-1',
      assetTag: 'AST-1',
    });
    mocks.prisma.attachment.findUnique.mockResolvedValue(attachmentRow());
    mocks.prisma.attachment.update.mockResolvedValue({});
  });

  it('soft-archives (sets archivedAt) and audits — uploader allowed', async () => {
    // viewer lacks asset.update but user-2 IS the uploader on the fixture...
    const uploader = { ...viewer, id: 'user-2' };
    await service.archive(uploader, 'att-1', {});
    expect(mocks.prisma.attachment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { archivedAt: expect.any(Date) },
      }),
    );
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attachment.archived' }),
    );
  });

  it('allows holders of the parent update-permission', async () => {
    await service.archive(custodian, 'att-1', {});
    expect(mocks.prisma.attachment.update).toHaveBeenCalled();
  });

  it('403s a non-uploader without parent update-permission', async () => {
    const error = await catchError(service.archive(viewer, 'att-1', {}));
    expectAppError(error, 403, 'FORBIDDEN');
    expect(mocks.prisma.attachment.update).not.toHaveBeenCalled();
  });
});
