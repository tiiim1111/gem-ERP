import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Paginated } from '@gemerp/shared';
import {
  GoodsReceiptStatus,
  Prisma,
  TrackingMethod,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { conversionFactor } from '../items/uom-conversion.util';
import {
  formatLotNumber,
  lotSequenceKey,
} from '../inventory/inventory-numbers';
import type { LotInputDto } from '../inventory/dto/create-stock-transaction.dto';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  formatGoodsReceiptNumber,
  goodsReceiptSequenceKey,
} from './procurement-numbers';
import {
  canReceiveAgainst,
  outstandingQuantity,
} from './purchase-order-rules';
import {
  canViewProcurementCost,
  GR_DETAIL_SELECT,
  GR_LIST_SELECT,
  GoodsReceiptDetailView,
  GoodsReceiptView,
  toGoodsReceiptDetailView,
  toGoodsReceiptView,
} from './procurement-views';
import {
  CreateGoodsReceiptDto,
  GoodsReceiptLineDto,
  QueryGoodsReceiptsDto,
  UpdateGoodsReceiptDto,
} from './dto/goods-receipt.dto';

const SORTABLE = {
  receiptNumber: 'receiptNumber',
  receiptDate: 'receiptDate',
  status: 'status',
  createdAt: 'createdAt',
};

export interface PreparedGrLine {
  purchaseOrderLineId: string;
  itemId: string;
  uomId: string;
  receivedQuantity: Prisma.Decimal;
  baseQuantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  serialNumbers: string[];
  lotId: string | null;
  pendingLot: { itemId: string; itemSku: string; input: LotInputDto } | null;
  storageLocationId: string | null;
  notes: string | null;
}

/**
 * Goods receipt drafts (api-outline 5.3): receive against an APPROVED (or
 * partially received) PO; partial and multiple receipts supported. Stock,
 * serialized assets, and lots materialize only when the receipt is POSTED
 * (GoodsReceiptPostingService) — a draft receipt moves nothing.
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    user: AuthUser,
    query: QueryGoodsReceiptsDto,
  ): Promise<Paginated<GoodsReceiptView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });

    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }
    const where: Prisma.GoodsReceiptWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
    };
    if (query.status) {
      where.status = query.status;
    }
    if (query.purchaseOrderId) {
      where.purchaseOrderId = query.purchaseOrderId;
    }
    if (query.supplierId) {
      where.purchaseOrder = { supplierId: query.supplierId };
    }
    if (query.number) {
      where.receiptNumber = { contains: query.number, mode: 'insensitive' };
    }
    if (query.from || query.to) {
      where.receiptDate = {
        ...(query.from ? { gte: this.toDate(query.from) } : {}),
        ...(query.to ? { lte: this.toDate(query.to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where,
        orderBy,
        skip,
        take,
        select: GR_LIST_SELECT,
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return paginated(rows.map(toGoodsReceiptView), page, pageSize, total);
  }

  async getById(user: AuthUser, id: string): Promise<GoodsReceiptDetailView> {
    const row = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      select: GR_DETAIL_SELECT,
    });
    if (!row || !this.branchScope.canAccess(user, row.branch.id)) {
      throw AppException.notFound('Goods receipt not found.');
    }
    return toGoodsReceiptDetailView(row, canViewProcurementCost(user));
  }

  /** GET /purchase-orders/:id/receipts (outline 5.2). */
  async listForPurchaseOrder(
    user: AuthUser,
    purchaseOrderId: string,
  ): Promise<GoodsReceiptView[]> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { id: true, branchId: true },
    });
    if (!po || !this.branchScope.canAccess(user, po.branchId)) {
      throw AppException.notFound('Purchase order not found.');
    }
    const rows = await this.prisma.goodsReceipt.findMany({
      where: { purchaseOrderId },
      orderBy: { createdAt: 'asc' },
      select: GR_LIST_SELECT,
    });
    return rows.map(toGoodsReceiptView);
  }

  // -------------------------------------------------------------------------
  // Create / update drafts
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreateGoodsReceiptDto,
    ctx: AuditContext,
  ): Promise<GoodsReceiptDetailView> {
    const po = await this.requireReceivablePo(user, dto.purchaseOrderId);
    const receiptDate = this.toDate(
      dto.receivedDate ?? new Date().toISOString(),
    );
    const prepared = await this.prepareLines(po, dto.lines);

    const created = await this.prisma.$transaction(async (tx) => {
      const year = receiptDate.getUTCFullYear();
      const sequence = await this.sequences.next(
        tx,
        goodsReceiptSequenceKey(year),
      );
      const receipt = await tx.goodsReceipt.create({
        data: {
          receiptNumber: formatGoodsReceiptNumber(year, sequence),
          purchaseOrderId: po.id,
          branchId: po.branchId,
          warehouseId: po.destinationWarehouseId,
          status: GoodsReceiptStatus.DRAFT,
          receiptDate,
          supplierReference: dto.supplierReference ?? null,
          notes: dto.notes ?? null,
          createdById: user.id,
        },
        select: { id: true, receiptNumber: true },
      });
      await this.writeLines(tx, receipt.id, prepared);
      return receipt;
    });

    await this.audit.log({
      action: 'goods_receipt.created',
      resourceType: 'goods_receipt',
      resourceId: created.id,
      branchId: po.branchId,
      newValues: {
        receiptNumber: created.receiptNumber,
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        lineCount: dto.lines.length,
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateGoodsReceiptDto,
    ctx: AuditContext,
  ): Promise<GoodsReceiptDetailView> {
    const existing = await this.requireReceipt(user, id);
    if (existing.status !== GoodsReceiptStatus.DRAFT) {
      throw AppException.invalidStateTransition(
        `Cannot update a ${existing.status} goods receipt (only drafts are editable).`,
      );
    }
    const po = await this.requireReceivablePo(
      user,
      existing.purchaseOrderId,
    );
    const prepared = dto.lines
      ? await this.prepareLines(po, dto.lines)
      : null;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.goodsReceipt.updateMany({
        where: { id, version: dto.version, status: GoodsReceiptStatus.DRAFT },
        data: {
          ...(dto.receivedDate
            ? { receiptDate: this.toDate(dto.receivedDate) }
            : {}),
          ...(dto.supplierReference !== undefined
            ? { supplierReference: dto.supplierReference }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.versionConflict();
      }
      if (prepared) {
        await tx.goodsReceiptLine.deleteMany({ where: { goodsReceiptId: id } });
        await this.writeLines(tx, id, prepared);
      }
    });

    await this.audit.log({
      action: 'goods_receipt.updated',
      resourceType: 'goods_receipt',
      resourceId: id,
      branchId: existing.branchId,
      oldValues: { version: dto.version },
      newValues: { linesReplaced: Boolean(prepared) },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async cancel(
    user: AuthUser,
    id: string,
    reason: string,
    ctx: AuditContext,
  ): Promise<GoodsReceiptDetailView> {
    const existing = await this.requireReceipt(user, id);
    if (existing.status !== GoodsReceiptStatus.DRAFT) {
      throw AppException.invalidStateTransition(
        `Cannot cancel a ${existing.status} goods receipt (only drafts; posted receipts are reversed instead).`,
      );
    }
    const claimed = await this.prisma.goodsReceipt.updateMany({
      where: { id, status: GoodsReceiptStatus.DRAFT },
      data: {
        status: GoodsReceiptStatus.CANCELED,
        canceledById: user.id,
        canceledAt: new Date(),
        notes: this.appendNote(existing.notes, `[canceled: ${reason}]`),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The goods receipt was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'goods_receipt.canceled',
      resourceType: 'goods_receipt',
      resourceId: id,
      branchId: existing.branchId,
      oldValues: { status: existing.status },
      newValues: { status: GoodsReceiptStatus.CANCELED },
      reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Shared guards / preparation (also used by the posting service)
  // -------------------------------------------------------------------------

  async requireReceipt(user: AuthUser, id: string) {
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      select: {
        id: true,
        receiptNumber: true,
        status: true,
        branchId: true,
        warehouseId: true,
        purchaseOrderId: true,
        receiptDate: true,
        notes: true,
        idempotencyKey: true,
      },
    });
    if (!receipt || !this.branchScope.canAccess(user, receipt.branchId)) {
      throw AppException.notFound('Goods receipt not found.');
    }
    return receipt;
  }

  /** PO must be in scope and APPROVED / PARTIALLY_RECEIVED to receive. */
  async requireReceivablePo(user: AuthUser, purchaseOrderId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        poNumber: true,
        status: true,
        branchId: true,
        supplierId: true,
        destinationWarehouseId: true,
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: {
            id: true,
            lineNumber: true,
            itemId: true,
            uomId: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            receivedQuantity: true,
            canceledQuantity: true,
          },
        },
      },
    });
    if (!po || !this.branchScope.canAccess(user, po.branchId)) {
      throw AppException.notFound('Purchase order not found.');
    }
    if (!canReceiveAgainst(po.status)) {
      throw AppException.invalidStateTransition(
        `Goods can only be received against an APPROVED or PARTIALLY_RECEIVED purchase order (current: ${po.status}).`,
      );
    }
    return po;
  }

  /**
   * Validates receipt lines against the PO: line linkage, PO-line UOM,
   * serial counts, lot rules, locations, and an advisory over-receipt check
   * (the authoritative check re-runs inside the posting transaction).
   */
  async prepareLines(
    po: Awaited<ReturnType<GoodsReceiptsService['requireReceivablePo']>>,
    lines: GoodsReceiptLineDto[],
  ): Promise<PreparedGrLine[]> {
    const errors: ApiErrorDetail[] = [];
    const poLineById = new Map(po.lines.map((line) => [line.id, line]));
    const itemIds = [...new Set(po.lines.map((line) => line.itemId))];
    const lotIds = [
      ...new Set(
        lines.map((line) => line.lotId).filter((v): v is string => !!v),
      ),
    ];
    const locationIds = [
      ...new Set(
        lines.map((line) => line.locationId).filter((v): v is string => !!v),
      ),
    ];

    const [items, globalConversions, lots, locations, warehouse] =
      await Promise.all([
        this.prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: {
            id: true,
            sku: true,
            isActive: true,
            trackingMethod: true,
            isExpiryTracked: true,
            baseUomId: true,
            uomConversions: {
              select: { fromUomId: true, toUomId: true, factor: true },
            },
          },
        }),
        this.prisma.uomConversion.findMany({
          where: { itemId: null },
          select: { fromUomId: true, toUomId: true, factor: true },
        }),
        lotIds.length > 0
          ? this.prisma.inventoryLot.findMany({
              where: { id: { in: lotIds } },
              select: { id: true, itemId: true, lotNumber: true },
            })
          : Promise.resolve([]),
        locationIds.length > 0
          ? this.prisma.storageLocation.findMany({
              where: { id: { in: locationIds } },
              select: { id: true, warehouseId: true, isActive: true },
            })
          : Promise.resolve([]),
        this.prisma.warehouse.findUnique({
          where: { id: po.destinationWarehouseId },
          select: { defaultReceivingLocationId: true },
        }),
      ]);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));
    const locationById = new Map(
      locations.map((location) => [location.id, location]),
    );
    const defaultReceivingLocationId =
      warehouse?.defaultReceivingLocationId ?? null;

    const prepared: PreparedGrLine[] = [];
    const serialsByItem = new Map<string, Set<string>>();
    lines.forEach((line, index) => {
      const field = (name: string) => `lines[${index}].${name}`;
      const poLine = poLineById.get(line.poLineId);
      if (!poLine) {
        errors.push({
          field: field('poLineId'),
          message: 'The referenced line does not belong to this purchase order.',
        });
        return;
      }
      const item = itemById.get(poLine.itemId);
      if (!item) {
        errors.push({
          field: field('poLineId'),
          message: 'The PO line item no longer exists.',
        });
        return;
      }
      // Received quantities are entered in the PO line UOM — mixed-unit
      // receiving against one line is deliberately unsupported.
      if (line.uomId && line.uomId !== poLine.uomId) {
        errors.push({
          field: field('uomId'),
          message: `Received quantity must be entered in the PO line UOM.`,
        });
        return;
      }

      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.lte(0)) {
        errors.push({
          field: field('quantity'),
          message: 'Quantity must be greater than zero.',
        });
        return;
      }

      // Serial rules (spec §14 receiving): one serial per received unit.
      let serialNumbers: string[] = [];
      if (item.trackingMethod === TrackingMethod.SERIAL) {
        if (!quantity.isInteger()) {
          errors.push({
            field: field('quantity'),
            message: `${item.sku} is serialized — the quantity must be a whole number of units.`,
          });
          return;
        }
        const serials = (line.serials ?? []).map((serial) => serial.trim());
        if (serials.some((serial) => serial.length === 0)) {
          errors.push({
            field: field('serials'),
            message: 'Serial numbers cannot be blank.',
          });
          return;
        }
        if (serials.length !== quantity.toNumber()) {
          errors.push({
            field: field('serials'),
            message: `${item.sku} is serialized: provide exactly ${quantity.toString()} serial number(s), got ${serials.length}.`,
          });
          return;
        }
        const seen = serialsByItem.get(item.id) ?? new Set<string>();
        for (const serial of serials) {
          if (seen.has(serial)) {
            errors.push({
              field: field('serials'),
              message: `Serial number "${serial}" appears more than once in this receipt.`,
            });
            return;
          }
          seen.add(serial);
        }
        serialsByItem.set(item.id, seen);
        serialNumbers = serials;
      } else if (line.serials && line.serials.length > 0) {
        errors.push({
          field: field('serials'),
          message: `${item.sku} is not serialized — serials do not apply.`,
        });
        return;
      }

      // Lot rules: LOT items always arrive into a lot (spec §13/§14).
      let lotId: string | null = null;
      let pendingLot: PreparedGrLine['pendingLot'] = null;
      if (item.trackingMethod === TrackingMethod.LOT) {
        if (line.lotId) {
          const lot = lotById.get(line.lotId);
          if (!lot) {
            errors.push({ field: field('lotId'), message: 'Lot does not exist.' });
            return;
          }
          if (lot.itemId !== item.id) {
            errors.push({
              field: field('lotId'),
              message: `Lot ${lot.lotNumber} belongs to a different item.`,
            });
            return;
          }
          lotId = lot.id;
        } else if (line.lotInput) {
          if (item.isExpiryTracked && !line.lotInput.expiryDate) {
            errors.push({
              field: field('lotInput.expiryDate'),
              message: `${item.sku} is expiry-tracked: expiryDate is required.`,
            });
            return;
          }
          pendingLot = { itemId: item.id, itemSku: item.sku, input: line.lotInput };
        } else {
          errors.push({
            field: field('lotId'),
            message: `${item.sku} is LOT-tracked: provide lotId or lotInput.`,
          });
          return;
        }
      } else if (line.lotId || line.lotInput) {
        errors.push({
          field: field('lotId'),
          message: `${item.sku} is not LOT-tracked.`,
        });
        return;
      }

      // Destination location: defaults to the warehouse receiving location.
      let storageLocationId: string | null = defaultReceivingLocationId;
      if (line.locationId) {
        const location = locationById.get(line.locationId);
        if (!location || !location.isActive) {
          errors.push({
            field: field('locationId'),
            message: 'Storage location does not exist or is inactive.',
          });
          return;
        }
        if (location.warehouseId !== po.destinationWarehouseId) {
          errors.push({
            field: field('locationId'),
            message:
              'Storage location belongs to a different warehouse than the PO destination.',
          });
          return;
        }
        storageLocationId = location.id;
      }

      const factor = conversionFactor(poLine.uomId, item.baseUomId, [
        ...item.uomConversions,
        ...globalConversions,
      ]);
      if (factor === null) {
        errors.push({
          field: field('quantity'),
          message: `No UOM conversion path from the PO line unit to the base unit of ${item.sku}.`,
        });
        return;
      }
      const baseQuantity = quantity
        .mul(new Prisma.Decimal(factor.toString()))
        .toDecimalPlaces(4);

      // Effective net unit cost from the PO line (price − discount + tax,
      // spread per unit): the acquisition cost of received stock and assets.
      const unitCost = poLine.quantity.gt(0)
        ? poLine.lineTotal.div(poLine.quantity).toDecimalPlaces(2)
        : poLine.unitPrice;

      prepared.push({
        purchaseOrderLineId: poLine.id,
        itemId: item.id,
        uomId: poLine.uomId,
        receivedQuantity: quantity,
        baseQuantity,
        unitCost,
        serialNumbers,
        lotId,
        pendingLot,
        storageLocationId,
        notes: line.notes ?? null,
      });
    });

    if (errors.length > 0) {
      throw AppException.validation(errors);
    }

    // Advisory over-receipt check (fail fast at the desk; the posting
    // transaction re-checks authoritatively under the PO row lock).
    this.assertWithinOutstanding(po.lines, prepared);

    // Serials must not already exist on registered assets of the item.
    await this.assertSerialsUnregistered(serialsByItem);
    return prepared;
  }

  /**
   * Per PO line: Σ received in this document ≤ outstanding. Violations are a
   * 409 OVER_RECEIPT — a configurable tolerance/override is a noted future
   * extension (spec §14 receiving); today the block is hard.
   */
  assertWithinOutstanding(
    poLines: Array<{
      id: string;
      lineNumber: number;
      quantity: Prisma.Decimal;
      receivedQuantity: Prisma.Decimal;
      canceledQuantity: Prisma.Decimal;
    }>,
    prepared: Array<{
      purchaseOrderLineId: string;
      receivedQuantity: Prisma.Decimal;
    }>,
  ): void {
    const receivingByPoLine = new Map<string, Prisma.Decimal>();
    for (const line of prepared) {
      receivingByPoLine.set(
        line.purchaseOrderLineId,
        (
          receivingByPoLine.get(line.purchaseOrderLineId) ??
          new Prisma.Decimal(0)
        ).add(line.receivedQuantity),
      );
    }
    const details: ApiErrorDetail[] = [];
    for (const [poLineId, receiving] of receivingByPoLine) {
      const poLine = poLines.find((line) => line.id === poLineId);
      if (!poLine) {
        continue; // linkage already validated
      }
      const outstanding = outstandingQuantity(poLine);
      if (receiving.gt(outstanding)) {
        details.push({
          field: `poLine[${poLine.lineNumber}]`,
          message: `Receiving ${receiving.toString()} exceeds the outstanding quantity ${outstanding.toString()} (ordered ${poLine.quantity.toString()}, already received ${poLine.receivedQuantity.toString()}, canceled ${poLine.canceledQuantity.toString()}).`,
        });
      }
    }
    if (details.length > 0) {
      throw new AppException(
        409,
        'OVER_RECEIPT',
        'Received quantity would exceed the ordered quantity. Over-receipt tolerances are not configured — adjust the receipt or amend the order.',
        details,
      );
    }
  }

  private async assertSerialsUnregistered(
    serialsByItem: Map<string, Set<string>>,
  ): Promise<void> {
    for (const [itemId, serials] of serialsByItem) {
      if (serials.size === 0) {
        continue;
      }
      const clash = await this.prisma.asset.findFirst({
        where: { itemId, serialNumber: { in: [...serials] } },
        select: { assetTag: true, serialNumber: true },
      });
      if (clash) {
        throw AppException.duplicateCode(
          `Serial number "${clash.serialNumber}" is already registered on asset ${clash.assetTag}.`,
        );
      }
    }
  }

  /** Materializes pending lots and writes the line rows (inside the doc tx). */
  private async writeLines(
    tx: Prisma.TransactionClient,
    goodsReceiptId: string,
    prepared: PreparedGrLine[],
  ): Promise<void> {
    let lineNumber = 0;
    for (const line of prepared) {
      lineNumber += 1;
      let lotId = line.lotId;
      if (line.pendingLot) {
        lotId = await this.resolveLot(tx, line.pendingLot);
      }
      await tx.goodsReceiptLine.create({
        data: {
          goodsReceiptId,
          purchaseOrderLineId: line.purchaseOrderLineId,
          lineNumber,
          itemId: line.itemId,
          uomId: line.uomId,
          receivedQuantity: line.receivedQuantity,
          baseQuantity: line.baseQuantity,
          unitCost: line.unitCost,
          serialNumbers: line.serialNumbers,
          lotId,
          storageLocationId: line.storageLocationId,
          notes: line.notes,
        },
      });
    }
  }

  /**
   * Find-or-create a lot for a receipt line (same semantics as stock
   * transactions): explicit lot numbers are reused, generated ones follow
   * LOT-{SKU}-{YYYYMMDD}-{SEQ} from sequence_counters.
   */
  private async resolveLot(
    tx: Prisma.TransactionClient,
    pending: { itemId: string; itemSku: string; input: LotInputDto },
  ): Promise<string> {
    const { input, itemId, itemSku } = pending;
    if (input.lotNumber) {
      const existing = await tx.inventoryLot.findUnique({
        where: { itemId_lotNumber: { itemId, lotNumber: input.lotNumber } },
        select: { id: true },
      });
      if (existing) {
        return existing.id;
      }
    }
    const now = new Date();
    const lotNumber =
      input.lotNumber ??
      formatLotNumber(
        itemSku,
        now,
        await this.sequences.next(tx, lotSequenceKey(itemSku, now)),
      );
    const lot = await tx.inventoryLot.create({
      data: {
        itemId,
        lotNumber,
        supplierLotNumber: input.supplierLotNumber ?? null,
        manufactureDate: input.manufactureDate
          ? this.toDate(input.manufactureDate)
          : null,
        expiryDate: input.expiryDate ? this.toDate(input.expiryDate) : null,
        barcode: lotNumber,
      },
      select: { id: true },
    });
    return lot.id;
  }

  private appendNote(notes: string | null, addition: string): string {
    return notes ? `${notes}\n${addition}` : addition;
  }

  private toDate(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
