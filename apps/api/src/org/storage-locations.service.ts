import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { Prisma, StorageLocation } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStorageLocationDto,
  UpdateStorageLocationDto,
} from './dto/storage-location.dto';
import { StorageLocationQueryDto } from './dto/org-query.dto';

const SORTABLE = {
  code: 'code',
  name: 'name',
  sortOrder: 'sortOrder',
  createdAt: 'createdAt',
};

type WarehouseWithBranch = Prisma.WarehouseGetPayload<{
  include: { branch: { select: { id: true; code: true } } };
}>;

@Injectable()
export class StorageLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  async listForWarehouse(
    user: AuthUser,
    warehouseId: string,
    query: StorageLocationQueryDto,
  ): Promise<Paginated<StorageLocation>> {
    await this.requireAccessibleWarehouse(user, warehouseId);

    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'sortOrder',
      direction: 'asc',
    });

    const where: Prisma.StorageLocationWhereInput = { warehouseId };
    if (query.parentId) {
      where.parentId = query.parentId;
    }
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { name: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [rows, total] = await Promise.all([
      this.prisma.storageLocation.findMany({ where, orderBy, skip, take }),
      this.prisma.storageLocation.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async create(
    user: AuthUser,
    warehouseId: string,
    dto: CreateStorageLocationDto,
    ctx: AuditContext,
  ): Promise<StorageLocation> {
    const warehouse = await this.requireAccessibleWarehouse(user, warehouseId);

    const duplicate = await this.prisma.storageLocation.findUnique({
      where: { warehouseId_code: { warehouseId, code: dto.code } },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `A storage location with code "${dto.code}" already exists in this warehouse.`,
      );
    }

    if (dto.parentId) {
      await this.assertParentInWarehouse(warehouseId, dto.parentId);
    }

    const location = await this.prisma.storageLocation.create({
      data: {
        warehouseId,
        parentId: dto.parentId ?? null,
        code: dto.code,
        name: dto.name,
        locationType: dto.locationType ?? null,
        sortOrder: dto.sortOrder ?? 0,
        // Bin/location label barcode: BIN-{BRANCH}-{WH}-{LOC} (spec section 5).
        barcode: `BIN-${warehouse.branch.code}-${warehouse.code}-${dto.code}`,
      },
    });

    await this.audit.log({
      action: 'storage_location.created',
      resourceType: 'storage_location',
      resourceId: location.id,
      branchId: warehouse.branchId,
      newValues: {
        code: location.code,
        name: location.name,
        parentId: location.parentId,
        locationType: location.locationType,
        barcode: location.barcode,
      },
      ...ctx,
    });
    return location;
  }

  async getById(user: AuthUser, id: string): Promise<StorageLocation> {
    const location = await this.prisma.storageLocation.findUnique({
      where: { id },
      include: { warehouse: { select: { branchId: true } } },
    });
    if (
      !location ||
      !this.branchScope.canAccess(user, location.warehouse.branchId)
    ) {
      throw AppException.notFound('Storage location not found.');
    }
    const { warehouse: _warehouse, ...rest } = location;
    return rest;
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateStorageLocationDto,
    ctx: AuditContext,
  ): Promise<StorageLocation> {
    const location = await this.prisma.storageLocation.findUnique({
      where: { id },
      include: { warehouse: { select: { branchId: true } } },
    });
    if (
      !location ||
      !this.branchScope.canAccess(user, location.warehouse.branchId)
    ) {
      throw AppException.notFound('Storage location not found.');
    }

    if (dto.parentId !== undefined && dto.parentId !== null) {
      await this.assertParentInWarehouse(location.warehouseId, dto.parentId);
      await this.assertNoCycle(id, dto.parentId);
    }

    const updated = await this.prisma.storageLocation.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.locationType !== undefined
          ? { locationType: dto.locationType }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.audit.log({
      action: 'storage_location.updated',
      resourceType: 'storage_location',
      resourceId: id,
      branchId: location.warehouse.branchId,
      oldValues: this.snapshot(location),
      newValues: this.snapshot(updated),
      ...ctx,
    });
    return updated;
  }

  private async requireAccessibleWarehouse(
    user: AuthUser,
    warehouseId: string,
  ): Promise<WarehouseWithBranch> {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: { branch: { select: { id: true, code: true } } },
    });
    // The warehouse itself is a scoped record: hidden entirely when
    // inaccessible (404 — no existence leak).
    if (!warehouse || !this.branchScope.canAccess(user, warehouse.branchId)) {
      throw AppException.notFound('Warehouse not found.');
    }
    return warehouse;
  }

  private async assertParentInWarehouse(
    warehouseId: string,
    parentId: string,
  ): Promise<void> {
    const parent = await this.prisma.storageLocation.findUnique({
      where: { id: parentId },
      select: { warehouseId: true },
    });
    if (!parent || parent.warehouseId !== warehouseId) {
      throw AppException.validation([
        {
          field: 'parentId',
          message:
            'Parent location does not exist or belongs to another warehouse.',
        },
      ]);
    }
  }

  /** Re-parenting must not create a cycle in the location tree. */
  private async assertNoCycle(id: string, newParentId: string): Promise<void> {
    let cursor: string | null = newParentId;
    let hops = 0;
    while (cursor !== null && hops < 100) {
      if (cursor === id) {
        throw AppException.validation([
          {
            field: 'parentId',
            message: 'A storage location cannot be nested under itself.',
          },
        ]);
      }
      const parent: { parentId: string | null } | null =
        await this.prisma.storageLocation.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
      hops += 1;
    }
  }

  private snapshot(location: StorageLocation) {
    return {
      name: location.name,
      parentId: location.parentId,
      locationType: location.locationType,
      sortOrder: location.sortOrder,
      isActive: location.isActive,
    };
  }
}
