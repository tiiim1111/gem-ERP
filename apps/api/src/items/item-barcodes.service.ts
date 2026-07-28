import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { CreateItemBarcodeDto } from './dto/item-barcode.dto';

const BARCODE_SELECT = {
  id: true,
  itemId: true,
  barcode: true,
  barcodeType: true,
  isPrimary: true,
  active: true,
  deactivatedAt: true,
  createdAt: true,
  uom: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ItemBarcodeSelect;

type BarcodeRow = Prisma.ItemBarcodeGetPayload<{ select: typeof BARCODE_SELECT }>;

interface ItemSummary {
  id: string;
  sku: string;
  name: string;
  businessCategory: string;
  trackingMethod: string;
  isActive: boolean;
  baseUom: { id: string; code: string };
}

/** Discriminated result for scanner workflows (GET /items/resolve-barcode). */
export type ResolvedBarcode =
  | {
      type: 'item';
      code: string;
      item: ItemSummary;
      /** The matched mapping — null when the code matched the SKU itself. */
      mapping: {
        id: string;
        barcodeType: string | null;
        isPrimary: boolean;
        uom: { id: string; code: string; name: string } | null;
      } | null;
    }
  | {
      type: 'storage_location';
      code: string;
      storageLocation: {
        id: string;
        code: string;
        name: string;
        locationType: string | null;
        warehouse: { id: string; code: string; name: string; branchId: string };
      };
    }
  | {
      type: 'lot';
      code: string;
      lot: {
        id: string;
        lotNumber: string;
        expiryDate: Date | null;
        manufactureDate: Date | null;
      };
      item: ItemSummary;
    };

const ITEM_SUMMARY_SELECT = {
  id: true,
  sku: true,
  name: true,
  businessCategory: true,
  trackingMethod: true,
  isActive: true,
  baseUom: { select: { id: true, code: true } },
} satisfies Prisma.ItemSelect;

@Injectable()
export class ItemBarcodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  async listForItem(itemId: string): Promise<BarcodeRow[]> {
    await this.requireItem(itemId);
    return this.prisma.itemBarcode.findMany({
      where: { itemId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: BARCODE_SELECT,
    });
  }

  async addToItem(
    itemId: string,
    dto: CreateItemBarcodeDto,
    ctx: AuditContext,
  ): Promise<BarcodeRow> {
    const item = await this.requireItem(itemId);

    // At most one ACTIVE mapping per barcode across ALL items (spec §11).
    const activeElsewhere = await this.prisma.itemBarcode.findFirst({
      where: { barcode: dto.barcode, active: true },
      select: { itemId: true, item: { select: { sku: true } } },
    });
    if (activeElsewhere) {
      throw AppException.duplicateCode(
        `Barcode "${dto.barcode}" is already actively mapped to item ${activeElsewhere.item.sku}.`,
      );
    }
    if (dto.uomId) {
      const uom = await this.prisma.unitOfMeasure.findUnique({
        where: { id: dto.uomId },
        select: { id: true },
      });
      if (!uom) {
        throw AppException.validation([
          { field: 'uomId', message: 'Unit of measure does not exist.' },
        ]);
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        // A single primary mapping per item: demote the current one.
        await tx.itemBarcode.updateMany({
          where: { itemId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.itemBarcode.create({
        data: {
          itemId,
          barcode: dto.barcode,
          barcodeType: dto.barcodeType ?? 'SUPPLIER',
          uomId: dto.uomId ?? null,
          isPrimary: dto.isPrimary ?? false,
        },
        select: BARCODE_SELECT,
      });
    });

    await this.audit.log({
      action: 'item.barcode_added',
      resourceType: 'item',
      resourceId: itemId,
      newValues: {
        sku: item.sku,
        barcode: created.barcode,
        barcodeType: created.barcodeType,
        isPrimary: created.isPrimary,
      },
      ...ctx,
    });
    return created;
  }

  /**
   * Soft archive. `active` flips to NULL (never false): the partial-unique
   * [barcode, active] pattern then frees the code for a new active mapping
   * while keeping full history.
   */
  async archive(
    itemId: string,
    barcodeId: string,
    ctx: AuditContext,
  ): Promise<void> {
    await this.requireItem(itemId);
    const mapping = await this.prisma.itemBarcode.findUnique({
      where: { id: barcodeId },
      select: { id: true, itemId: true, barcode: true, active: true },
    });
    if (!mapping || mapping.itemId !== itemId) {
      throw AppException.notFound('Barcode mapping not found.');
    }
    if (mapping.active !== true) {
      throw AppException.invalidStateTransition(
        'This barcode mapping is already archived.',
      );
    }

    await this.prisma.itemBarcode.update({
      where: { id: barcodeId },
      data: { active: null, isPrimary: false, deactivatedAt: new Date() },
    });
    await this.audit.log({
      action: 'item.barcode_archived',
      resourceType: 'item',
      resourceId: itemId,
      oldValues: { barcode: mapping.barcode, active: true },
      newValues: { barcode: mapping.barcode, active: null },
      ...ctx,
    });
  }

  /**
   * Resolve any scanned code: item SKU, active item barcode mapping,
   * storage-location (bin) barcode, or lot barcode. Resolution is real —
   * lot codes simply return 404 until Phase 3 creates lots.
   */
  async resolve(user: AuthUser, code: string): Promise<ResolvedBarcode> {
    // 1. Active item barcode mapping (at most one exists system-wide).
    const mapping = await this.prisma.itemBarcode.findFirst({
      where: { barcode: code, active: true },
      select: {
        id: true,
        barcodeType: true,
        isPrimary: true,
        uom: { select: { id: true, code: true, name: true } },
        item: { select: ITEM_SUMMARY_SELECT },
      },
    });
    if (mapping) {
      const { item, ...rest } = mapping;
      return { type: 'item', code, item, mapping: rest };
    }

    // 2. The SKU itself doubles as the internal item barcode.
    const bySku = await this.prisma.item.findUnique({
      where: { sku: code },
      select: ITEM_SUMMARY_SELECT,
    });
    if (bySku) {
      return { type: 'item', code, item: bySku, mapping: null };
    }

    // 3. Storage-location (bin) labels — branch-scoped, 404 when out of scope.
    const location = await this.prisma.storageLocation.findUnique({
      where: { barcode: code },
      select: {
        id: true,
        code: true,
        name: true,
        locationType: true,
        warehouse: {
          select: { id: true, code: true, name: true, branchId: true },
        },
      },
    });
    if (location) {
      if (!this.branchScope.canAccess(user, location.warehouse.branchId)) {
        throw AppException.notFound('No record matches this code.');
      }
      return { type: 'storage_location', code, storageLocation: location };
    }

    // 4. Lot barcodes (populated from Phase 3 onward).
    const lot = await this.prisma.inventoryLot.findUnique({
      where: { barcode: code },
      select: {
        id: true,
        lotNumber: true,
        expiryDate: true,
        manufactureDate: true,
        item: { select: ITEM_SUMMARY_SELECT },
      },
    });
    if (lot) {
      const { item, ...rest } = lot;
      return { type: 'lot', code, lot: rest, item };
    }

    throw AppException.notFound('No record matches this code.');
  }

  private async requireItem(id: string): Promise<{ id: string; sku: string }> {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: { id: true, sku: true },
    });
    if (!item) {
      throw AppException.notFound('Item not found.');
    }
    return item;
  }
}
