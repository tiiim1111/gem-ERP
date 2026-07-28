import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { UpsertWarehouseSettingDto } from './dto/warehouse-setting.dto';

const SETTING_SELECT = {
  id: true,
  itemId: true,
  reorderLevel: true,
  reorderQuantity: true,
  minQuantity: true,
  maxQuantity: true,
  defaultStorageLocationId: true,
  createdAt: true,
  updatedAt: true,
  warehouse: {
    select: { id: true, code: true, name: true, branchId: true },
  },
} satisfies Prisma.ItemWarehouseSettingSelect;

type SettingRow = Prisma.ItemWarehouseSettingGetPayload<{
  select: typeof SETTING_SELECT;
}>;

export interface WarehouseSettingView {
  id: string;
  itemId: string;
  warehouse: { id: string; code: string; name: string; branchId: string };
  reorderLevel: string | null;
  reorderQuantity: string | null;
  minQuantity: string | null;
  maxQuantity: string | null;
  defaultStorageLocationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ItemWarehouseSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Settings for accessible branches only (warehouses are branch-owned). */
  async listForItem(
    user: AuthUser,
    itemId: string,
  ): Promise<WarehouseSettingView[]> {
    await this.requireItem(itemId);
    const branchFilter = this.branchScope.branchFilter(user);
    const rows = await this.prisma.itemWarehouseSetting.findMany({
      where: {
        itemId,
        ...(branchFilter ? { warehouse: { branchId: branchFilter } } : {}),
      },
      orderBy: { warehouse: { code: 'asc' } },
      select: SETTING_SELECT,
    });
    return rows.map((row) => this.toView(row));
  }

  /** Full replace (PUT): omitted fields clear to null. */
  async upsert(
    user: AuthUser,
    itemId: string,
    warehouseId: string,
    dto: UpsertWarehouseSettingDto,
    ctx: AuditContext,
  ): Promise<WarehouseSettingView> {
    await this.requireItem(itemId);
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, branchId: true },
    });
    if (!warehouse) {
      throw AppException.notFound('Warehouse not found.');
    }
    // Explicitly targeted warehouse outside the caller's branches → 403.
    this.branchScope.assertBranchAccess(user, warehouse.branchId);

    if (
      dto.minQuantity != null &&
      dto.maxQuantity != null &&
      dto.maxQuantity < dto.minQuantity
    ) {
      throw AppException.validation([
        { field: 'maxQuantity', message: 'maxQuantity must be ≥ minQuantity.' },
      ]);
    }
    if (dto.defaultStorageLocationId) {
      const location = await this.prisma.storageLocation.findUnique({
        where: { id: dto.defaultStorageLocationId },
        select: { warehouseId: true },
      });
      if (!location || location.warehouseId !== warehouseId) {
        throw AppException.validation([
          {
            field: 'defaultStorageLocationId',
            message: 'Location does not exist or belongs to another warehouse.',
          },
        ]);
      }
    }

    const existing = await this.prisma.itemWarehouseSetting.findUnique({
      where: { itemId_warehouseId: { itemId, warehouseId } },
      select: SETTING_SELECT,
    });
    const values = {
      reorderLevel: dto.reorderLevel ?? null,
      reorderQuantity: dto.reorderQuantity ?? null,
      minQuantity: dto.minQuantity ?? null,
      maxQuantity: dto.maxQuantity ?? null,
      defaultStorageLocationId: dto.defaultStorageLocationId ?? null,
    };
    const setting = await this.prisma.itemWarehouseSetting.upsert({
      where: { itemId_warehouseId: { itemId, warehouseId } },
      update: values,
      create: { itemId, warehouseId, ...values },
      select: SETTING_SELECT,
    });

    await this.audit.log({
      action: existing
        ? 'item.warehouse_setting_updated'
        : 'item.warehouse_setting_created',
      resourceType: 'item',
      resourceId: itemId,
      branchId: warehouse.branchId,
      oldValues: existing ? this.snapshot(existing) : undefined,
      newValues: this.snapshot(setting),
      ...ctx,
    });
    return this.toView(setting);
  }

  private async requireItem(id: string): Promise<void> {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!item) {
      throw AppException.notFound('Item not found.');
    }
  }

  private snapshot(row: SettingRow) {
    return {
      warehouseId: row.warehouse.id,
      reorderLevel: row.reorderLevel?.toString() ?? null,
      reorderQuantity: row.reorderQuantity?.toString() ?? null,
      minQuantity: row.minQuantity?.toString() ?? null,
      maxQuantity: row.maxQuantity?.toString() ?? null,
      defaultStorageLocationId: row.defaultStorageLocationId,
    };
  }

  private toView(row: SettingRow): WarehouseSettingView {
    return {
      id: row.id,
      itemId: row.itemId,
      warehouse: row.warehouse,
      reorderLevel: row.reorderLevel?.toString() ?? null,
      reorderQuantity: row.reorderQuantity?.toString() ?? null,
      minQuantity: row.minQuantity?.toString() ?? null,
      maxQuantity: row.maxQuantity?.toString() ?? null,
      defaultStorageLocationId: row.defaultStorageLocationId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
