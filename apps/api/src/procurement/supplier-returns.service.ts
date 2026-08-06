import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Paginated } from '@gemerp/shared';
import {
  GoodsReceiptStatus,
  Prisma,
  StockDocumentStatus,
  StockTransactionType,
  TrackingMethod,
} from '@prisma/client';
import { ApprovalEngineService } from '../approvals/approval-engine.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { conversionFactor } from '../items/uom-conversion.util';
import {
  formatStockTransactionNumber,
  stockTransactionSequenceKey,
} from '../inventory/inventory-numbers';
import {
  canTransition,
  transitionError,
} from '../inventory/stock-transaction-rules';
import { StockPostingService } from '../inventory/stock-posting.service';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  formatSupplierReturnNumber,
  supplierReturnSequenceKey,
} from './procurement-numbers';
import {
  canViewProcurementCost,
  SUPPLIER_RETURN_DETAIL_SELECT,
  SUPPLIER_RETURN_LIST_SELECT,
  SupplierReturnDetailView,
  SupplierReturnView,
  toSupplierReturnDetailView,
  toSupplierReturnView,
} from './procurement-views';
import {
  CreateSupplierReturnDto,
  QuerySupplierReturnsDto,
  SupplierReturnLineDto,
  UpdateSupplierReturnDto,
} from './dto/supplier-return.dto';

const SORTABLE = {
  returnNumber: 'returnNumber',
  returnDate: 'returnDate',
  status: 'status',
  createdAt: 'createdAt',
};

/** Reason lookup categories a supplier return may reference. */
const RETURN_REASON_CATEGORIES = [
  'RETURN_REASON',
  'ADJUSTMENT_REASON',
  'TRANSACTION_REASON',
];

interface PreparedReturnLine {
  itemId: string;
  lotId: string | null;
  uomId: string;
  quantity: Prisma.Decimal;
  baseQuantity: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
  storageLocationId: string | null;
  notes: string | null;
}

/**
 * Return-to-supplier documents (api-outline 5.4): a controlled draft that,
 * when posted, moves stock OUT through the shared posting engine as a
 * RETURN_TO_SUPPLIER transaction linked to this document (and the goods
 * receipt that delivered the stock, when referenced). Serialized assets are
 * returned through the asset lifecycle (disposal/transfer), not here.
 */
@Injectable()
export class SupplierReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly posting: StockPostingService,
    private readonly approvals: ApprovalEngineService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    user: AuthUser,
    query: QuerySupplierReturnsDto,
  ): Promise<Paginated<SupplierReturnView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });

    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }
    const where: Prisma.SupplierReturnWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
    };
    if (query.status) {
      where.status = query.status;
    }
    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }
    if (query.goodsReceiptId) {
      where.goodsReceiptId = query.goodsReceiptId;
    }
    if (query.from || query.to) {
      where.returnDate = {
        ...(query.from ? { gte: this.toDate(query.from) } : {}),
        ...(query.to ? { lte: this.toDate(query.to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.supplierReturn.findMany({
        where,
        orderBy,
        skip,
        take,
        select: SUPPLIER_RETURN_LIST_SELECT,
      }),
      this.prisma.supplierReturn.count({ where }),
    ]);
    return paginated(rows.map(toSupplierReturnView), page, pageSize, total);
  }

  async getById(
    user: AuthUser,
    id: string,
  ): Promise<SupplierReturnDetailView> {
    const row = await this.prisma.supplierReturn.findUnique({
      where: { id },
      select: SUPPLIER_RETURN_DETAIL_SELECT,
    });
    if (!row || !this.branchScope.canAccess(user, row.branch.id)) {
      throw AppException.notFound('Supplier return not found.');
    }
    return toSupplierReturnDetailView(row, canViewProcurementCost(user));
  }

  // -------------------------------------------------------------------------
  // Create / update drafts
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreateSupplierReturnDto,
    ctx: AuditContext,
  ): Promise<SupplierReturnDetailView> {
    this.branchScope.assertBranchAccess(user, dto.branchId);
    await this.requireActiveSupplier(dto.supplierId);
    await this.requireWarehouse(dto.warehouseId, dto.branchId);
    const receipt = await this.validateGoodsReceipt(
      dto.goodsReceiptId,
      dto.supplierId,
      dto.branchId,
    );
    const reasonId = await this.resolveReason(dto.reasonId);
    const prepared = await this.prepareLines(
      dto.warehouseId,
      dto.lines,
      receipt?.itemIds ?? null,
    );

    const returnDate = this.toDate(dto.returnDate ?? new Date().toISOString());
    const created = await this.prisma.$transaction(async (tx) => {
      const year = returnDate.getUTCFullYear();
      const sequence = await this.sequences.next(
        tx,
        supplierReturnSequenceKey(year),
      );
      const doc = await tx.supplierReturn.create({
        data: {
          returnNumber: formatSupplierReturnNumber(year, sequence),
          supplierId: dto.supplierId,
          branchId: dto.branchId,
          warehouseId: dto.warehouseId,
          goodsReceiptId: dto.goodsReceiptId ?? null,
          status: StockDocumentStatus.DRAFT,
          returnDate,
          reasonId,
          notes: dto.notes ?? null,
          createdById: user.id,
        },
        select: { id: true, returnNumber: true },
      });
      await this.writeLines(tx, doc.id, prepared);
      return doc;
    });

    await this.audit.log({
      action: 'supplier_return.created',
      resourceType: 'supplier_return',
      resourceId: created.id,
      branchId: dto.branchId,
      newValues: {
        returnNumber: created.returnNumber,
        supplierId: dto.supplierId,
        goodsReceiptId: dto.goodsReceiptId ?? null,
        lineCount: dto.lines.length,
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateSupplierReturnDto,
    ctx: AuditContext,
  ): Promise<SupplierReturnDetailView> {
    const existing = await this.requireReturn(user, id);
    if (!canTransition(existing.status, 'update')) {
      throw AppException.invalidStateTransition(
        transitionError(existing.status, 'update'),
      );
    }
    const reasonId =
      dto.reasonId !== undefined
        ? await this.resolveReason(dto.reasonId ?? undefined)
        : undefined;
    const receiptItems = existing.goodsReceiptId
      ? await this.validateGoodsReceipt(
          existing.goodsReceiptId,
          existing.supplierId,
          existing.branchId,
        )
      : null;
    const prepared = dto.lines
      ? await this.prepareLines(
          existing.warehouseId,
          dto.lines,
          receiptItems?.itemIds ?? null,
        )
      : null;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.supplierReturn.updateMany({
        where: { id, version: dto.version, status: StockDocumentStatus.DRAFT },
        data: {
          ...(dto.returnDate
            ? { returnDate: this.toDate(dto.returnDate) }
            : {}),
          ...(reasonId !== undefined ? { reasonId } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.versionConflict();
      }
      if (prepared) {
        await tx.supplierReturnLine.deleteMany({
          where: { supplierReturnId: id },
        });
        await this.writeLines(tx, id, prepared);
      }
    });

    await this.audit.log({
      action: 'supplier_return.updated',
      resourceType: 'supplier_return',
      resourceId: id,
      branchId: existing.branchId,
      oldValues: { version: dto.version },
      newValues: { linesReplaced: Boolean(prepared) },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Workflow actions
  // -------------------------------------------------------------------------

  async submit(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<SupplierReturnDetailView> {
    const doc = await this.requireReturn(user, id);
    if (!canTransition(doc.status, 'submit')) {
      throw AppException.invalidStateTransition(
        transitionError(doc.status, 'submit'),
      );
    }
    const lineCount = await this.prisma.supplierReturnLine.count({
      where: { supplierReturnId: id },
    });
    if (lineCount === 0) {
      throw AppException.validation([
        {
          field: 'lines',
          message: 'A supplier return needs at least one line before submission.',
        },
      ]);
    }

    // Phase 6 approval engine: route through the most specific matching
    // active workflow. No match → auto-approve exactly as before.
    const now = new Date();
    const totals = await this.prisma.supplierReturnLine.aggregate({
      where: { supplierReturnId: id },
      _sum: { baseQuantity: true },
    });
    const routed = await this.approvals.routeSubmit(
      {
        resourceType: 'SUPPLIER_RETURN',
        resourceId: id,
        resourceNumber: doc.returnNumber,
        branchId: doc.branchId,
        quantity: totals._sum.baseQuantity,
        requester: user,
      },
      async (tx) => {
        const claimedPending = await tx.supplierReturn.updateMany({
          where: { id, status: StockDocumentStatus.DRAFT },
          data: {
            status: StockDocumentStatus.PENDING_APPROVAL,
            version: { increment: 1 },
          },
        });
        if (claimedPending.count === 0) {
          throw AppException.invalidStateTransition(
            'The supplier return was modified concurrently. Refetch and retry.',
          );
        }
      },
      ctx,
    );

    const autoApproved = !routed;
    if (autoApproved) {
      const claimed = await this.prisma.supplierReturn.updateMany({
        where: { id, status: StockDocumentStatus.DRAFT },
        data: {
          status: StockDocumentStatus.APPROVED,
          approvedById: user.id,
          approvedAt: now,
          notes: this.appendNote(
            doc.notes,
            '[auto-approved on submit: no approval workflow matched]',
          ),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.invalidStateTransition(
          'The supplier return was modified concurrently. Refetch and retry.',
        );
      }
    }

    await this.audit.log({
      action: autoApproved
        ? 'supplier_return.submitted_auto_approved'
        : 'supplier_return.submitted',
      resourceType: 'supplier_return',
      resourceId: id,
      branchId: doc.branchId,
      oldValues: { status: doc.status },
      newValues: {
        status: autoApproved
          ? StockDocumentStatus.APPROVED
          : StockDocumentStatus.PENDING_APPROVAL,
        autoApproved,
      },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async approve(
    user: AuthUser,
    id: string,
    comment: string | undefined,
    ctx: AuditContext,
  ): Promise<SupplierReturnDetailView> {
    const doc = await this.requireReturn(user, id);
    if (!canTransition(doc.status, 'approve')) {
      throw AppException.invalidStateTransition(
        transitionError(doc.status, 'approve'),
      );
    }
    // Phase 6: engine-managed returns are decided through the engine.
    const handled = await this.approvals.actOnResource(
      user,
      'SUPPLIER_RETURN',
      id,
      'APPROVE',
      comment,
      ctx,
    );
    if (handled) {
      return this.getById(user, id);
    }
    if (doc.createdById === user.id) {
      throw new AppException(
        409,
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot approve your own supplier return.',
      );
    }

    const claimed = await this.prisma.supplierReturn.updateMany({
      where: { id, status: StockDocumentStatus.PENDING_APPROVAL },
      data: {
        status: StockDocumentStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
        ...(comment
          ? { notes: this.appendNote(doc.notes, `[approval: ${comment}]`) }
          : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The supplier return was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'supplier_return.approved',
      resourceType: 'supplier_return',
      resourceId: id,
      branchId: doc.branchId,
      oldValues: { status: doc.status },
      newValues: { status: StockDocumentStatus.APPROVED },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async cancel(
    user: AuthUser,
    id: string,
    reason: string,
    ctx: AuditContext,
  ): Promise<SupplierReturnDetailView> {
    const doc = await this.requireReturn(user, id);
    if (!canTransition(doc.status, 'cancel')) {
      throw AppException.invalidStateTransition(
        transitionError(doc.status, 'cancel'),
      );
    }
    const claimed = await this.prisma.supplierReturn.updateMany({
      where: { id, status: doc.status },
      data: {
        status: StockDocumentStatus.CANCELED,
        notes: this.appendNote(doc.notes, `[canceled: ${reason}]`),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The supplier return was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'supplier_return.canceled',
      resourceType: 'supplier_return',
      resourceId: id,
      branchId: doc.branchId,
      oldValues: { status: doc.status },
      newValues: { status: StockDocumentStatus.CANCELED },
      reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // POST /supplier-returns/:id/post
  // -------------------------------------------------------------------------

  /**
   * Posts the stock-out to the supplier IN ONE database transaction: claims
   * APPROVED → POSTED, creates the linked RETURN_TO_SUPPLIER stock
   * transaction, and posts it through the shared engine (immutable ledger,
   * negative-stock guards → 409 INSUFFICIENT_STOCK). Idempotency-Key
   * required; replays return the original result.
   */
  async post(
    user: AuthUser,
    id: string,
    idempotencyKey: string | undefined,
    allowExpiredLots: boolean,
    ctx: AuditContext,
  ): Promise<SupplierReturnDetailView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const replayed = await this.checkPostReplay(user, key, id);
    if (replayed) {
      return replayed;
    }

    const doc = await this.requireReturn(user, id);
    if (!canTransition(doc.status, 'post')) {
      throw AppException.invalidStateTransition(
        transitionError(doc.status, 'post'),
      );
    }
    const lines = await this.prisma.supplierReturnLine.findMany({
      where: { supplierReturnId: id },
      orderBy: { lineNumber: 'asc' },
      select: {
        lineNumber: true,
        itemId: true,
        lotId: true,
        uomId: true,
        quantity: true,
        baseQuantity: true,
        unitCost: true,
        storageLocationId: true,
      },
    });
    if (lines.length === 0) {
      throw AppException.validation([
        { field: 'lines', message: 'The supplier return has no lines to post.' },
      ]);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const claimed = await tx.supplierReturn.updateMany({
          where: { id, status: StockDocumentStatus.APPROVED },
          data: {
            status: StockDocumentStatus.POSTED,
            postedById: user.id,
            postedAt: now,
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The supplier return was modified concurrently. Refetch and retry.',
          );
        }

        const year = doc.returnDate.getUTCFullYear();
        const sequence = await this.sequences.next(
          tx,
          stockTransactionSequenceKey(year),
        );
        const txn = await tx.stockTransaction.create({
          data: {
            transactionNumber: formatStockTransactionNumber(year, sequence),
            type: StockTransactionType.RETURN_TO_SUPPLIER,
            status: StockDocumentStatus.APPROVED,
            transactionDate: doc.returnDate,
            branchId: doc.branchId,
            sourceWarehouseId: doc.warehouseId,
            supplierId: doc.supplierId,
            goodsReceiptId: doc.goodsReceiptId,
            purchaseOrderId: doc.purchaseOrderId,
            supplierReturnId: id,
            reasonId: doc.reasonId,
            idempotencyKey: key,
            notes: `[system] Return to supplier ${doc.returnNumber}`,
            createdById: user.id,
            submittedAt: now,
            approvedById: user.id,
            approvedAt: now,
          },
          select: { id: true },
        });
        for (const line of lines) {
          await tx.stockTransactionLine.create({
            data: {
              transactionId: txn.id,
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              lotId: line.lotId,
              sourceLocationId: line.storageLocationId,
              enteredUomId: line.uomId,
              enteredQuantity: line.quantity,
              baseQuantity: line.baseQuantity,
              unitCost: line.unitCost,
              totalCost: line.unitCost
                ? line.unitCost.mul(line.quantity).toDecimalPlaces(2)
                : null,
              notes: `Return line ${line.lineNumber} of ${doc.returnNumber}`,
            },
          });
        }
        // Returning expired stock to the supplier is a normal flow, so the
        // caller may keep the expired-lot override on (default true).
        await this.posting.postWithinTx(tx, txn.id, user.id, {
          allowExpiredLots,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replayedAfterRace = await this.checkPostReplay(user, key, id);
        if (replayedAfterRace) {
          return replayedAfterRace;
        }
      }
      throw error;
    }

    await this.audit.log({
      action: 'supplier_return.posted',
      resourceType: 'supplier_return',
      resourceId: id,
      branchId: doc.branchId,
      oldValues: { status: doc.status },
      newValues: { status: StockDocumentStatus.POSTED },
      metadata: { idempotencyKey: key, returnNumber: doc.returnNumber },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Line preparation
  // -------------------------------------------------------------------------

  private async prepareLines(
    warehouseId: string,
    lines: SupplierReturnLineDto[],
    receiptItemIds: Set<string> | null,
  ): Promise<PreparedReturnLine[]> {
    const errors: ApiErrorDetail[] = [];
    const itemIds = [...new Set(lines.map((line) => line.itemId))];
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
    const autoLocateItemIds = [
      ...new Set(
        lines.filter((line) => !line.locationId).map((line) => line.itemId),
      ),
    ];

    const [items, globalConversions, lots, locations, buckets] =
      await Promise.all([
        this.prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: {
            id: true,
            sku: true,
            isActive: true,
            trackingMethod: true,
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
        autoLocateItemIds.length > 0
          ? this.prisma.stockBalance.findMany({
              where: { warehouseId, itemId: { in: autoLocateItemIds } },
              select: {
                itemId: true,
                storageLocationId: true,
                lotId: true,
                onHandQty: true,
                reservedQty: true,
              },
            })
          : Promise.resolve([]),
      ]);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));
    const locationById = new Map(
      locations.map((location) => [location.id, location]),
    );

    const prepared: PreparedReturnLine[] = [];
    lines.forEach((line, index) => {
      const field = (name: string) => `lines[${index}].${name}`;
      const item = itemById.get(line.itemId);
      if (!item) {
        errors.push({ field: field('itemId'), message: 'Item does not exist.' });
        return;
      }
      if (!item.isActive) {
        errors.push({
          field: field('itemId'),
          message: `Item ${item.sku} is inactive.`,
        });
        return;
      }
      if (item.trackingMethod === TrackingMethod.SERIAL) {
        errors.push({
          field: field('itemId'),
          message: `${item.sku} is serialized — individual assets go back to the supplier through the asset lifecycle, not quantity returns.`,
        });
        return;
      }
      if (receiptItemIds && !receiptItemIds.has(item.id)) {
        errors.push({
          field: field('itemId'),
          message: `${item.sku} was not delivered by the referenced goods receipt.`,
        });
        return;
      }

      let lotId: string | null = null;
      if (item.trackingMethod === TrackingMethod.LOT) {
        if (!line.lotId) {
          errors.push({
            field: field('lotId'),
            message: `${item.sku} is LOT-tracked: the returned lot is required.`,
          });
          return;
        }
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
      } else if (line.lotId) {
        errors.push({
          field: field('lotId'),
          message: `${item.sku} is not LOT-tracked.`,
        });
        return;
      }

      let storageLocationId: string | null = null;
      if (line.locationId) {
        const location = locationById.get(line.locationId);
        if (!location || !location.isActive) {
          errors.push({
            field: field('locationId'),
            message: 'Storage location does not exist or is inactive.',
          });
          return;
        }
        if (location.warehouseId !== warehouseId) {
          errors.push({
            field: field('locationId'),
            message: 'Storage location belongs to a different warehouse.',
          });
          return;
        }
        storageLocationId = location.id;
      } else {
        // Auto-resolve when exactly one location holds available stock
        // (same convention as outbound stock transactions).
        const candidates = [
          ...new Set(
            buckets
              .filter(
                (bucket) =>
                  bucket.itemId === item.id &&
                  (lotId ? bucket.lotId === lotId : true) &&
                  Number(bucket.onHandQty) - Number(bucket.reservedQty) > 0,
              )
              .map((bucket) => bucket.storageLocationId),
          ),
        ];
        if (candidates.length === 1) {
          storageLocationId = candidates[0];
        } else if (candidates.length > 1) {
          errors.push({
            field: field('locationId'),
            message: `${item.sku} is stocked in multiple locations of this warehouse — specify locationId.`,
          });
          return;
        }
        // Zero candidates: leave null — posting reports INSUFFICIENT_STOCK.
      }

      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.lte(0)) {
        errors.push({
          field: field('quantity'),
          message: 'Quantity must be greater than zero.',
        });
        return;
      }
      const factor = conversionFactor(line.uomId, item.baseUomId, [
        ...item.uomConversions,
        ...globalConversions,
      ]);
      if (factor === null) {
        errors.push({
          field: field('uomId'),
          message: `No UOM conversion path from the entered unit to the base unit of ${item.sku}.`,
        });
        return;
      }
      const baseQuantity = quantity
        .mul(new Prisma.Decimal(factor.toString()))
        .toDecimalPlaces(4);
      if (baseQuantity.lte(0)) {
        errors.push({
          field: field('quantity'),
          message:
            'Normalized base quantity rounds to zero — use a larger quantity or a smaller unit.',
        });
        return;
      }

      prepared.push({
        itemId: item.id,
        lotId,
        uomId: line.uomId,
        quantity,
        baseQuantity,
        unitCost: line.unitCost ? new Prisma.Decimal(line.unitCost) : null,
        storageLocationId,
        notes: line.notes ?? null,
      });
    });

    if (errors.length > 0) {
      throw AppException.validation(errors);
    }

    const uomIds = [...new Set(lines.map((line) => line.uomId))];
    const uomCount = await this.prisma.unitOfMeasure.count({
      where: { id: { in: uomIds } },
    });
    if (uomCount !== uomIds.length) {
      throw AppException.validation([
        { field: 'lines', message: 'One or more entered UOMs do not exist.' },
      ]);
    }
    return prepared;
  }

  private async writeLines(
    tx: Prisma.TransactionClient,
    supplierReturnId: string,
    prepared: PreparedReturnLine[],
  ): Promise<void> {
    let lineNumber = 0;
    for (const line of prepared) {
      lineNumber += 1;
      await tx.supplierReturnLine.create({
        data: {
          supplierReturnId,
          lineNumber,
          itemId: line.itemId,
          lotId: line.lotId,
          uomId: line.uomId,
          quantity: line.quantity,
          baseQuantity: line.baseQuantity,
          unitCost: line.unitCost,
          storageLocationId: line.storageLocationId,
          notes: line.notes,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private requireIdempotencyKey(key: string | undefined): string {
    const trimmed = key?.trim();
    if (!trimmed || trimmed.length < 8 || trimmed.length > 200) {
      throw AppException.validation([
        {
          field: 'Idempotency-Key',
          message:
            'The Idempotency-Key header is required on this endpoint (8-200 characters, e.g. a UUID).',
        },
      ]);
    }
    return trimmed;
  }

  private async checkPostReplay(
    user: AuthUser,
    key: string,
    targetId: string,
  ): Promise<SupplierReturnDetailView | null> {
    const existing = await this.prisma.stockTransaction.findUnique({
      where: { idempotencyKey: key },
      select: { supplierReturnId: true, type: true },
    });
    if (!existing) {
      return null;
    }
    if (
      existing.type !== StockTransactionType.RETURN_TO_SUPPLIER ||
      existing.supplierReturnId !== targetId
    ) {
      throw new AppException(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used for a different operation.',
      );
    }
    return this.getById(user, targetId);
  }

  private async requireActiveSupplier(supplierId: string): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, code: true, isActive: true, archivedAt: true },
    });
    if (!supplier || supplier.archivedAt) {
      throw AppException.validation([
        { field: 'supplierId', message: 'Supplier does not exist.' },
      ]);
    }
    if (!supplier.isActive) {
      throw AppException.validation([
        {
          field: 'supplierId',
          message: `Supplier ${supplier.code} is inactive.`,
        },
      ]);
    }
  }

  private async requireWarehouse(
    warehouseId: string,
    branchId: string,
  ): Promise<void> {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, branchId: true, isActive: true },
    });
    if (!warehouse || !warehouse.isActive) {
      throw AppException.validation([
        {
          field: 'warehouseId',
          message: 'Warehouse does not exist or is inactive.',
        },
      ]);
    }
    if (warehouse.branchId !== branchId) {
      throw AppException.validation([
        {
          field: 'warehouseId',
          message: 'Warehouse belongs to a different branch.',
        },
      ]);
    }
  }

  /**
   * A referenced goods receipt must be POSTED, in the same branch, and from
   * the same supplier (via its PO). Returns the receipt's item set so lines
   * can be validated as "referencing received stock" (outline 5.4).
   */
  private async validateGoodsReceipt(
    goodsReceiptId: string | undefined,
    supplierId: string,
    branchId: string,
  ): Promise<{ itemIds: Set<string> } | null> {
    if (!goodsReceiptId) {
      return null;
    }
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id: goodsReceiptId },
      select: {
        id: true,
        status: true,
        branchId: true,
        purchaseOrder: { select: { supplierId: true } },
        lines: { select: { itemId: true } },
      },
    });
    if (!receipt || receipt.branchId !== branchId) {
      throw AppException.validation([
        {
          field: 'goodsReceiptId',
          message: 'Goods receipt does not exist in this branch.',
        },
      ]);
    }
    if (receipt.status !== GoodsReceiptStatus.POSTED) {
      throw AppException.validation([
        {
          field: 'goodsReceiptId',
          message: `Only POSTED goods receipts can be returned against (current: ${receipt.status}).`,
        },
      ]);
    }
    if (receipt.purchaseOrder.supplierId !== supplierId) {
      throw AppException.validation([
        {
          field: 'goodsReceiptId',
          message: 'The goods receipt belongs to a different supplier.',
        },
      ]);
    }
    return { itemIds: new Set(receipt.lines.map((line) => line.itemId)) };
  }

  private async resolveReason(
    reasonId: string | undefined,
  ): Promise<string | null> {
    if (!reasonId) {
      return null;
    }
    const reason = await this.prisma.lookupValue.findFirst({
      where: {
        id: reasonId,
        category: { in: RETURN_REASON_CATEGORIES },
        isActive: true,
      },
      select: { id: true },
    });
    if (!reason) {
      throw AppException.validation([
        {
          field: 'reasonId',
          message: `Reason must be an active lookup value in ${RETURN_REASON_CATEGORIES.join(', ')}.`,
        },
      ]);
    }
    return reason.id;
  }

  private async requireReturn(user: AuthUser, id: string) {
    const doc = await this.prisma.supplierReturn.findUnique({
      where: { id },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        branchId: true,
        warehouseId: true,
        supplierId: true,
        goodsReceiptId: true,
        goodsReceipt: { select: { purchaseOrderId: true } },
        reasonId: true,
        returnDate: true,
        notes: true,
        createdById: true,
      },
    });
    if (!doc || !this.branchScope.canAccess(user, doc.branchId)) {
      throw AppException.notFound('Supplier return not found.');
    }
    return { ...doc, purchaseOrderId: doc.goodsReceipt?.purchaseOrderId ?? null };
  }

  private appendNote(notes: string | null, addition: string): string {
    return notes ? `${notes}\n${addition}` : addition;
  }

  private toDate(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
