import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { BusinessCategory, TrackingMethod, type Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import { formatSku, skuSequenceKey } from '../sequences/sequence.util';
import { CreateItemDto } from './dto/create-item.dto';
import { QueryItemsDto } from './dto/query-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { TRACKING_RULES } from './item-classification';

const ITEM_LIST_SELECT = {
  id: true,
  sku: true,
  name: true,
  description: true,
  businessCategory: true,
  trackingMethod: true,
  model: true,
  standardCost: true,
  lastPurchaseCost: true,
  isLotTracked: true,
  isExpiryTracked: true,
  requiresSerialNumber: true,
  isMaintainable: true,
  imageUrl: true,
  version: true,
  isActive: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, code: true, name: true } },
  subcategory: { select: { id: true, code: true, name: true } },
  brand: { select: { id: true, code: true, name: true } },
  manufacturer: { select: { id: true, code: true, name: true } },
  baseUom: { select: { id: true, code: true, name: true } },
  purchaseUom: { select: { id: true, code: true, name: true } },
  issueUom: { select: { id: true, code: true, name: true } },
  defaultSupplier: { select: { id: true, code: true, legalName: true } },
} satisfies Prisma.ItemSelect;

type ItemListRow = Prisma.ItemGetPayload<{ select: typeof ITEM_LIST_SELECT }>;

export type ItemView = Omit<ItemListRow, 'standardCost' | 'lastPurchaseCost'> & {
  /** Present only with item.view_cost. Serialized as decimal strings. */
  standardCost?: string | null;
  lastPurchaseCost?: string | null;
};

export interface ItemDetailView extends ItemView {
  notes: string | null;
  barcodes: Array<{
    id: string;
    barcode: string;
    barcodeType: string | null;
    isPrimary: boolean;
    active: boolean | null;
    uom: { id: string; code: string } | null;
  }>;
  uomConversions: Array<{
    id: string;
    factor: string;
    itemId: string | null;
    fromUom: { id: string; code: string };
    toUom: { id: string; code: string };
  }>;
  warehouseSettings: Array<{
    id: string;
    warehouse: { id: string; code: string; name: string; branchId: string };
    reorderLevel: string | null;
    reorderQuantity: string | null;
    minQuantity: string | null;
    maxQuantity: string | null;
    defaultStorageLocationId: string | null;
  }>;
}

const SORTABLE = {
  sku: 'sku',
  name: 'name',
  createdAt: 'createdAt',
  businessCategory: 'businessCategory',
  trackingMethod: 'trackingMethod',
};

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  async list(user: AuthUser, query: QueryItemsDto): Promise<Paginated<ItemView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'sku',
      direction: 'asc',
    });

    const where: Prisma.ItemWhereInput = {};
    if (query.q) {
      where.OR = [
        { sku: { contains: query.q, mode: 'insensitive' } },
        { name: { contains: query.q, mode: 'insensitive' } },
        { model: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.businessCategory) {
      where.businessCategory = query.businessCategory;
    }
    if (query.trackingMethod) {
      where.trackingMethod = query.trackingMethod;
    }
    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }
    if (query.brandId) {
      where.brandId = query.brandId;
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.barcode) {
      where.AND = [
        {
          OR: [
            { sku: query.barcode },
            { barcodes: { some: { barcode: query.barcode, active: true } } },
          ],
        },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        orderBy,
        skip,
        take,
        select: ITEM_LIST_SELECT,
      }),
      this.prisma.item.count({ where }),
    ]);
    const includeCost = this.canViewCost(user);
    return paginated(
      rows.map((row) => this.toView(row, includeCost)),
      page,
      pageSize,
      total,
    );
  }

  async getById(user: AuthUser, id: string): Promise<ItemDetailView> {
    const row = await this.prisma.item.findUnique({
      where: { id },
      select: {
        ...ITEM_LIST_SELECT,
        notes: true,
        barcodes: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            barcode: true,
            barcodeType: true,
            isPrimary: true,
            active: true,
            uom: { select: { id: true, code: true } },
          },
        },
        uomConversions: {
          select: {
            id: true,
            factor: true,
            itemId: true,
            fromUom: { select: { id: true, code: true } },
            toUom: { select: { id: true, code: true } },
          },
        },
        warehouseSettings: {
          select: {
            id: true,
            reorderLevel: true,
            reorderQuantity: true,
            minQuantity: true,
            maxQuantity: true,
            defaultStorageLocationId: true,
            warehouse: {
              select: { id: true, code: true, name: true, branchId: true },
            },
          },
        },
      },
    });
    if (!row) {
      throw AppException.notFound('Item not found.');
    }

    const { notes, barcodes, uomConversions, warehouseSettings, ...listRow } = row;
    // Warehouse settings are branch-owned: only accessible branches appear.
    const scopedSettings = warehouseSettings.filter((setting) =>
      this.branchScope.canAccess(user, setting.warehouse.branchId),
    );
    return {
      ...this.toView(listRow, this.canViewCost(user)),
      notes,
      barcodes,
      uomConversions: uomConversions.map((conversion) => ({
        ...conversion,
        factor: conversion.factor.toString(),
      })),
      warehouseSettings: scopedSettings.map((setting) => ({
        id: setting.id,
        warehouse: setting.warehouse,
        reorderLevel: setting.reorderLevel?.toString() ?? null,
        reorderQuantity: setting.reorderQuantity?.toString() ?? null,
        minQuantity: setting.minQuantity?.toString() ?? null,
        maxQuantity: setting.maxQuantity?.toString() ?? null,
        defaultStorageLocationId: setting.defaultStorageLocationId,
      })),
    };
  }

  async create(
    user: AuthUser,
    dto: CreateItemDto,
    ctx: AuditContext,
  ): Promise<ItemDetailView> {
    const trackingMethod = this.resolveTrackingMethod(
      dto.businessCategory,
      dto.trackingMethod,
    );
    const flags = this.resolveTrackingFlags(trackingMethod, dto);
    await this.assertCatalogReferences(dto);

    let categoryCode: string | null = null;
    if (dto.categoryId) {
      const category = await this.prisma.itemCategory.findUnique({
        where: { id: dto.categoryId },
        select: { code: true },
      });
      categoryCode = category?.code ?? null;
    }
    if (!dto.sku && !categoryCode) {
      throw AppException.validation([
        {
          field: 'categoryId',
          message: 'categoryId is required when sku is omitted (SKU-{CATEGORY}-{SEQ}).',
        },
      ]);
    }
    if (dto.sku) {
      const skuTaken = await this.prisma.item.findUnique({
        where: { sku: dto.sku },
        select: { id: true },
      });
      if (skuTaken) {
        throw AppException.duplicateCode(`SKU "${dto.sku}" is already in use.`);
      }
    }
    if (dto.primaryBarcode) {
      await this.assertBarcodeAvailable(dto.primaryBarcode);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const sku =
        dto.sku ??
        formatSku(
          categoryCode as string,
          await this.sequences.next(tx, skuSequenceKey(categoryCode as string)),
        );
      const item = await tx.item.create({
        data: {
          sku,
          name: dto.name,
          description: dto.description ?? null,
          businessCategory: dto.businessCategory,
          trackingMethod,
          categoryId: dto.categoryId ?? null,
          subcategoryId: dto.subcategoryId ?? null,
          brandId: dto.brandId ?? null,
          manufacturerId: dto.manufacturerId ?? null,
          model: dto.model ?? null,
          baseUomId: dto.baseUomId,
          purchaseUomId: dto.purchaseUomId ?? null,
          issueUomId: dto.issueUomId ?? null,
          defaultSupplierId: dto.defaultSupplierId ?? null,
          standardCost: dto.standardCost ?? null,
          lastPurchaseCost: dto.lastPurchaseCost ?? null,
          ...flags,
          imageUrl: dto.imageUrl ?? null,
          notes: dto.notes ?? null,
        },
        select: { id: true, sku: true },
      });
      if (dto.primaryBarcode) {
        await tx.itemBarcode.create({
          data: {
            itemId: item.id,
            barcode: dto.primaryBarcode,
            barcodeType: 'INTERNAL',
            isPrimary: true,
          },
        });
      }
      return item;
    });

    await this.audit.log({
      action: 'item.created',
      resourceType: 'item',
      resourceId: created.id,
      newValues: {
        sku: created.sku,
        name: dto.name,
        businessCategory: dto.businessCategory,
        trackingMethod,
        primaryBarcode: dto.primaryBarcode ?? null,
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateItemDto,
    ctx: AuditContext,
  ): Promise<ItemDetailView> {
    const existing = await this.requireItem(id);
    if (existing.archivedAt) {
      throw AppException.invalidStateTransition(
        'This item is archived and can no longer be modified.',
      );
    }

    const businessCategory = dto.businessCategory ?? existing.businessCategory;
    const trackingMethod = dto.trackingMethod ?? existing.trackingMethod;
    const classificationChanged =
      businessCategory !== existing.businessCategory ||
      trackingMethod !== existing.trackingMethod;
    if (classificationChanged) {
      this.resolveTrackingMethod(businessCategory, trackingMethod);
      const usage = await this.usageCount(id);
      if (usage > 0) {
        throw AppException.invalidStateTransition(
          'businessCategory/trackingMethod are immutable once stock movements or assets exist for this item.',
        );
      }
    }
    await this.assertCatalogReferences({
      categoryId: dto.categoryId ?? undefined,
      subcategoryId: dto.subcategoryId ?? undefined,
      brandId: dto.brandId ?? undefined,
      manufacturerId: dto.manufacturerId ?? undefined,
      baseUomId: dto.baseUomId,
      purchaseUomId: dto.purchaseUomId ?? undefined,
      issueUomId: dto.issueUomId ?? undefined,
      defaultSupplierId: dto.defaultSupplierId ?? undefined,
    });

    const data: Prisma.ItemUncheckedUpdateManyInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.businessCategory !== undefined
        ? { businessCategory: dto.businessCategory }
        : {}),
      ...(dto.trackingMethod !== undefined
        ? { trackingMethod: dto.trackingMethod }
        : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.subcategoryId !== undefined
        ? { subcategoryId: dto.subcategoryId }
        : {}),
      ...(dto.brandId !== undefined ? { brandId: dto.brandId } : {}),
      ...(dto.manufacturerId !== undefined
        ? { manufacturerId: dto.manufacturerId }
        : {}),
      ...(dto.model !== undefined ? { model: dto.model } : {}),
      ...(dto.baseUomId !== undefined ? { baseUomId: dto.baseUomId } : {}),
      ...(dto.purchaseUomId !== undefined
        ? { purchaseUomId: dto.purchaseUomId }
        : {}),
      ...(dto.issueUomId !== undefined ? { issueUomId: dto.issueUomId } : {}),
      ...(dto.defaultSupplierId !== undefined
        ? { defaultSupplierId: dto.defaultSupplierId }
        : {}),
      ...(dto.standardCost !== undefined ? { standardCost: dto.standardCost } : {}),
      ...(dto.lastPurchaseCost !== undefined
        ? { lastPurchaseCost: dto.lastPurchaseCost }
        : {}),
      ...(dto.isLotTracked !== undefined ? { isLotTracked: dto.isLotTracked } : {}),
      ...(dto.isExpiryTracked !== undefined
        ? { isExpiryTracked: dto.isExpiryTracked }
        : {}),
      ...(dto.requiresSerialNumber !== undefined
        ? { requiresSerialNumber: dto.requiresSerialNumber }
        : {}),
      ...(dto.isMaintainable !== undefined
        ? { isMaintainable: dto.isMaintainable }
        : {}),
      ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    // Atomic optimistic-concurrency update: 0 rows touched = stale version.
    const result = await this.prisma.item.updateMany({
      where: { id, version: dto.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw AppException.versionConflict();
    }

    const updated = await this.requireItem(id);
    await this.audit.log({
      action: 'item.updated',
      resourceType: 'item',
      resourceId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
      ...ctx,
    });
    return this.getById(user, id);
  }

  async setActive(
    user: AuthUser,
    id: string,
    isActive: boolean,
    ctx: AuditContext,
  ): Promise<ItemDetailView> {
    const existing = await this.requireItem(id);
    if (existing.archivedAt) {
      throw AppException.invalidStateTransition(
        'This item is archived and can no longer be modified.',
      );
    }
    await this.prisma.item.update({
      where: { id },
      data: { isActive, version: { increment: 1 } },
    });
    await this.audit.log({
      action: isActive ? 'item.activated' : 'item.deactivated',
      resourceType: 'item',
      resourceId: id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive },
      ...ctx,
    });
    return this.getById(user, id);
  }

  /** Stock movements or assets that pin the item's tracking classification. */
  private async usageCount(id: string): Promise<number> {
    const usage = await this.prisma.item.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            assets: true,
            stockTransactionLines: true,
            stockLedgerEntries: true,
            stockBalances: true,
            lots: true,
          },
        },
      },
    });
    return Object.values(usage?._count ?? {}).reduce(
      (sum, count) => sum + count,
      0,
    );
  }

  private resolveTrackingMethod(
    businessCategory: BusinessCategory,
    trackingMethod?: TrackingMethod,
  ): TrackingMethod {
    const rules = TRACKING_RULES[businessCategory];
    const resolved = trackingMethod ?? rules.default;
    if (!rules.allowed.includes(resolved)) {
      throw AppException.validation([
        {
          field: 'trackingMethod',
          message: `${businessCategory} items allow tracking method ${rules.allowed.join(
            ' or ',
          )} (spec §4).`,
        },
      ]);
    }
    return resolved;
  }

  /** Coherence of lot/expiry/serial/maintenance flags with the tracking method. */
  private resolveTrackingFlags(
    trackingMethod: TrackingMethod,
    dto: Pick<
      CreateItemDto,
      'isLotTracked' | 'isExpiryTracked' | 'requiresSerialNumber' | 'isMaintainable'
    > & { businessCategory: BusinessCategory },
  ): {
    isLotTracked: boolean;
    isExpiryTracked: boolean;
    requiresSerialNumber: boolean;
    isMaintainable: boolean;
  } {
    const isLot = trackingMethod === TrackingMethod.LOT;
    const isSerial = trackingMethod === TrackingMethod.SERIAL;
    if (dto.isExpiryTracked && !isLot) {
      throw AppException.validation([
        {
          field: 'isExpiryTracked',
          message: 'Expiry tracking requires LOT tracking.',
        },
      ]);
    }
    if (dto.requiresSerialNumber && !isSerial) {
      throw AppException.validation([
        {
          field: 'requiresSerialNumber',
          message: 'Serial numbers apply only to SERIAL-tracked items.',
        },
      ]);
    }
    if (dto.isMaintainable && !isSerial) {
      throw AppException.validation([
        {
          field: 'isMaintainable',
          message:
            'Maintenance applies only to individually identifiable serialized instances (spec §4).',
        },
      ]);
    }
    return {
      isLotTracked: isLot ? true : (dto.isLotTracked ?? false),
      isExpiryTracked: isLot ? (dto.isExpiryTracked ?? false) : false,
      requiresSerialNumber: isSerial
        ? (dto.requiresSerialNumber ?? true)
        : false,
      isMaintainable: isSerial
        ? (dto.isMaintainable ??
          dto.businessCategory === BusinessCategory.SERIALIZED_ASSET)
        : false,
    };
  }

  private async assertCatalogReferences(refs: {
    categoryId?: string;
    subcategoryId?: string;
    brandId?: string;
    manufacturerId?: string;
    baseUomId?: string;
    purchaseUomId?: string;
    issueUomId?: string;
    defaultSupplierId?: string;
  }): Promise<void> {
    const check = async (
      field: string,
      id: string | undefined,
      finder: () => Promise<{ id: string } | null>,
    ): Promise<void> => {
      if (!id) {
        return;
      }
      const found = await finder();
      if (!found) {
        throw AppException.validation([
          { field, message: `Referenced ${field.replace(/Id$/, '')} does not exist.` },
        ]);
      }
    };

    await check('categoryId', refs.categoryId, () =>
      this.prisma.itemCategory.findUnique({
        where: { id: refs.categoryId },
        select: { id: true },
      }),
    );
    if (refs.subcategoryId) {
      const subcategory = await this.prisma.itemSubcategory.findUnique({
        where: { id: refs.subcategoryId },
        select: { id: true, categoryId: true },
      });
      if (!subcategory) {
        throw AppException.validation([
          { field: 'subcategoryId', message: 'Referenced subcategory does not exist.' },
        ]);
      }
      if (refs.categoryId && subcategory.categoryId !== refs.categoryId) {
        throw AppException.validation([
          {
            field: 'subcategoryId',
            message: 'Subcategory does not belong to the given category.',
          },
        ]);
      }
    }
    await check('brandId', refs.brandId, () =>
      this.prisma.brand.findUnique({
        where: { id: refs.brandId },
        select: { id: true },
      }),
    );
    await check('manufacturerId', refs.manufacturerId, () =>
      this.prisma.manufacturer.findUnique({
        where: { id: refs.manufacturerId },
        select: { id: true },
      }),
    );
    await check('baseUomId', refs.baseUomId, () =>
      this.prisma.unitOfMeasure.findUnique({
        where: { id: refs.baseUomId },
        select: { id: true },
      }),
    );
    await check('purchaseUomId', refs.purchaseUomId, () =>
      this.prisma.unitOfMeasure.findUnique({
        where: { id: refs.purchaseUomId },
        select: { id: true },
      }),
    );
    await check('issueUomId', refs.issueUomId, () =>
      this.prisma.unitOfMeasure.findUnique({
        where: { id: refs.issueUomId },
        select: { id: true },
      }),
    );
    await check('defaultSupplierId', refs.defaultSupplierId, () =>
      this.prisma.supplier.findUnique({
        where: { id: refs.defaultSupplierId },
        select: { id: true },
      }),
    );
  }

  /** Barcode may hold at most one ACTIVE mapping across ALL items (spec §11). */
  private async assertBarcodeAvailable(barcode: string): Promise<void> {
    const active = await this.prisma.itemBarcode.findFirst({
      where: { barcode, active: true },
      select: { item: { select: { sku: true } } },
    });
    if (active) {
      throw AppException.duplicateCode(
        `Barcode "${barcode}" is already actively mapped to item ${active.item.sku}.`,
      );
    }
  }

  private async requireItem(id: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        businessCategory: true,
        trackingMethod: true,
        categoryId: true,
        subcategoryId: true,
        brandId: true,
        manufacturerId: true,
        model: true,
        baseUomId: true,
        purchaseUomId: true,
        issueUomId: true,
        defaultSupplierId: true,
        standardCost: true,
        lastPurchaseCost: true,
        isLotTracked: true,
        isExpiryTracked: true,
        requiresSerialNumber: true,
        isMaintainable: true,
        isActive: true,
        version: true,
        archivedAt: true,
      },
    });
    if (!item) {
      throw AppException.notFound('Item not found.');
    }
    return item;
  }

  private canViewCost(user: AuthUser): boolean {
    return (
      user.isSuperAdmin || user.permissions.includes(PERMISSIONS.item.viewCost)
    );
  }

  private snapshot(item: Awaited<ReturnType<ItemsService['requireItem']>>) {
    return {
      sku: item.sku,
      name: item.name,
      businessCategory: item.businessCategory,
      trackingMethod: item.trackingMethod,
      categoryId: item.categoryId,
      subcategoryId: item.subcategoryId,
      brandId: item.brandId,
      manufacturerId: item.manufacturerId,
      model: item.model,
      baseUomId: item.baseUomId,
      purchaseUomId: item.purchaseUomId,
      issueUomId: item.issueUomId,
      defaultSupplierId: item.defaultSupplierId,
      standardCost: item.standardCost?.toString() ?? null,
      lastPurchaseCost: item.lastPurchaseCost?.toString() ?? null,
      isLotTracked: item.isLotTracked,
      isExpiryTracked: item.isExpiryTracked,
      requiresSerialNumber: item.requiresSerialNumber,
      isMaintainable: item.isMaintainable,
      isActive: item.isActive,
    };
  }

  /** Cost fields are serialized ONLY for callers holding item.view_cost. */
  private toView(row: ItemListRow, includeCost: boolean): ItemView {
    const { standardCost, lastPurchaseCost, ...rest } = row;
    return {
      ...rest,
      ...(includeCost
        ? {
            standardCost: standardCost?.toString() ?? null,
            lastPurchaseCost: lastPurchaseCost?.toString() ?? null,
          }
        : {}),
    };
  }
}
