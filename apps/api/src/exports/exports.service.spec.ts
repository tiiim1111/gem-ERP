import { HttpException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { ExportsService } from './exports.service';

/**
 * Export job lifecycle at the API edge with mocked Prisma/storage:
 * permission verification AT ENQUEUE (report.export route guard + underlying
 * report permission here), authorization snapshotting (includeCost /
 * branchIds), owner-only reads and downloads, and download state gating.
 * The worker-side processing is exercised through the shared registry and
 * renderer specs.
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    exportJob: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

const auditCtx = { actorUserId: 'user-1', correlationId: 'corr-1' };

const baseUser = {
  id: 'user-1',
  email: 'x@gemcor.dev',
  displayName: 'X',
  isSuperAdmin: false,
  roles: [],
  branchIds: ['branch-sub'],
  permissions: [
    PERMISSIONS.report.view,
    PERMISSIONS.report.export,
    PERMISSIONS.inventory.view,
  ],
  mustChangePassword: false,
};

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    reportKey: 'stock-on-hand',
    format: 'xlsx',
    filters: {},
    status: 'QUEUED',
    fileName: null,
    contentType: null,
    sizeBytes: null,
    rowCount: null,
    truncated: false,
    error: null,
    createdAt: new Date('2026-08-06T01:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(code);
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe('ExportsService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { log: MockFn };
  let storage: { getStream: MockFn };
  let service: ExportsService;

  beforeEach(() => {
    prisma = prismaMock();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    storage = { getStream: jest.fn() };
    service = new ExportsService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      storage as any,
    );
  });

  describe('create (enqueue)', () => {
    it('rejects an unknown report key', async () => {
      const error = await catchError(
        service.create(baseUser, { reportKey: 'nope', format: 'csv' }, auditCtx),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('verifies the underlying report permission at enqueue', async () => {
      const error = await catchError(
        service.create(
          baseUser,
          { reportKey: 'asset-register', format: 'csv' }, // needs asset.view
          auditCtx,
        ),
      );
      expectAppError(error, 403, 'FORBIDDEN');
      expect(prisma.exportJob.create).not.toHaveBeenCalled();
    });

    it('rejects filters the report does not support and out-of-scope branches', async () => {
      const badFilter = await catchError(
        service.create(
          baseUser,
          {
            reportKey: 'stock-on-hand',
            format: 'csv',
            filters: { employeeId: '3f0e8a4e-6f4e-4d0d-9a3f-2b1c5d6e7f80' },
          },
          auditCtx,
        ),
      );
      expectAppError(badFilter, 400, 'VALIDATION_ERROR');

      const outOfScope = await catchError(
        service.create(
          baseUser,
          {
            reportKey: 'stock-on-hand',
            format: 'csv',
            filters: { branchId: '9a6f5cf0-0000-4000-8000-000000000abc' },
          },
          auditCtx,
        ),
      );
      expectAppError(outOfScope, 403, 'FORBIDDEN');
      expect(prisma.exportJob.create).not.toHaveBeenCalled();
    });

    it('snapshots the evaluated authorization onto the job and audits the enqueue', async () => {
      prisma.exportJob.create.mockResolvedValue(jobRow());
      const view = await service.create(
        baseUser,
        { reportKey: 'stock-on-hand', format: 'xlsx' },
        auditCtx,
      );
      expect(view).toMatchObject({ id: 'job-1', status: 'queued' });
      const data = prisma.exportJob.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        reportKey: 'stock-on-hand',
        format: 'xlsx',
        requestedById: 'user-1',
        includeCost: false, // no inventory.view_cost
        branchIds: ['branch-sub'],
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'report.export_queued',
          resourceType: 'export_job',
          resourceId: 'job-1',
        }),
      );
    });

    it('snapshots includeCost=true and an unrestricted scope for a cost-permitted super admin', async () => {
      prisma.exportJob.create.mockResolvedValue(jobRow());
      const superAdmin = { ...baseUser, isSuperAdmin: true, branchIds: [] };
      await service.create(
        superAdmin,
        { reportKey: 'stock-on-hand', format: 'csv' },
        auditCtx,
      );
      const data = prisma.exportJob.create.mock.calls[0][0].data;
      expect(data.includeCost).toBe(true);
      expect(data.branchIds).toBe(Prisma.DbNull);
    });
  });

  describe('owner-only reads', () => {
    it('lists only the caller own jobs', async () => {
      await service.list(baseUser, {});
      expect(prisma.exportJob.findMany.mock.calls[0][0].where).toMatchObject({
        requestedById: 'user-1',
      });
    });

    it("404s another user's job — no existence leak", async () => {
      prisma.exportJob.findFirst.mockResolvedValue(null);
      const error = await catchError(service.getById(baseUser, 'job-of-someone-else'));
      expectAppError(error, 404, 'NOT_FOUND');
      expect(prisma.exportJob.findFirst.mock.calls[0][0].where).toMatchObject({
        requestedById: 'user-1',
      });
    });
  });

  describe('download', () => {
    it('409s while the job is not completed', async () => {
      prisma.exportJob.findFirst.mockResolvedValue(
        jobRow({ status: 'PROCESSING', storageKey: null }),
      );
      const error = await catchError(service.download(baseUser, 'job-1', auditCtx));
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    it('streams a completed file to its owner and audits the download', async () => {
      prisma.exportJob.findFirst.mockResolvedValue(
        jobRow({
          status: 'COMPLETED',
          storageKey: 'exports/job-1/stock-on-hand-20260806-010000.xlsx',
          fileName: 'stock-on-hand-20260806-010000.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 1234,
        }),
      );
      storage.getStream.mockResolvedValue({ body: Readable.from(['bytes']) });
      const download = await service.download(baseUser, 'job-1', auditCtx);
      expect(download.fileName).toBe('stock-on-hand-20260806-010000.xlsx');
      expect(download.sizeBytes).toBe(1234);
      expect(storage.getStream).toHaveBeenCalledWith(
        'exports/job-1/stock-on-hand-20260806-010000.xlsx',
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'report.export_downloaded' }),
      );
    });
  });
});
