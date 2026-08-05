import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Paginated } from '@gemerp/shared';
import {
  GoodsReceiptStatus,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { conversionFactor } from '../items/uom-conversion.util';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  formatPurchaseOrderNumber,
  purchaseOrderSequenceKey,
} from './procurement-numbers';
import {
  canTransitionPo,
  computeDocumentTotals,
  computeLineAmounts,
  outstandingQuantity,
  PoDocumentTotals,
  PoLineAmounts,
  poTransitionError,
} from './purchase-order-rules';
import {
  canViewProcurementCost,
  PO_DETAIL_SELECT,
  PO_LIST_SELECT,
  PurchaseOrderDetailView,
  PurchaseOrderView,
  toPurchaseOrderDetailView,
  toPurchaseOrderView,
} from './procurement-views';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderLineDto,
  QueryPurchaseOrdersDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';

const SORTABLE = {
  poNumber: 'poNumber',
  orderDate: 'orderDate',
  status: 'status',
  createdAt: 'createdAt',
};

interface PreparedPoLine extends PoLineAmounts {
  itemId: string;
  uomId: string;
  description: string | null;
  notes: string | null;
}

interface PreparedPoLines {
  lines: PreparedPoLine[];
  totals: PoDocumentTotals;
}

/**
 * Purchase order documents (spec §14, api-outline 5.2). Branch-scoped by the
 * ordering branch; all money math happens server-side in Decimal; approved
 * POs are immutable — material changes are cancel-and-recreate.
 */
@Injectable()
export class PurchaseOrdersService {
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
    query: QueryPurchaseOrdersDto,
  ): Promise<Paginated<PurchaseOrderView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });

    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }
    const where: Prisma.PurchaseOrderWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
    };
    if (query.status) {
      where.status = query.status;
    }
    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }
    if (query.warehouseId) {
      where.destinationWarehouseId = query.warehouseId;
    }
    if (query.number) {
      where.poNumber = { contains: query.number, mode: 'insensitive' };
    }
    if (query.from || query.to) {
      where.orderDate = {
        ...(query.from ? { gte: this.toDate(query.from) } : {}),
        ...(query.to ? { lte: this.toDate(query.to) } : {}),
      };
    }

    const includeCost = canViewProcurementCost(user);
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy,
        skip,
        take,
        select: PO_LIST_SELECT,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return paginated(
      rows.map((row) => toPurchaseOrderView(row, includeCost)),
      page,
      pageSize,
      total,
    );
  }

  async getById(
    user: AuthUser,
    id: string,
  ): Promise<PurchaseOrderDetailView> {
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: PO_DETAIL_SELECT,
    });
    if (!row || !this.branchScope.canAccess(user, row.branch.id)) {
      throw AppException.notFound('Purchase order not found.');
    }
    return toPurchaseOrderDetailView(row, canViewProcurementCost(user));
  }

  // -------------------------------------------------------------------------
  // Create / update drafts
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreatePurchaseOrderDto,
    ctx: AuditContext,
  ): Promise<PurchaseOrderDetailView> {
    this.branchScope.assertBranchAccess(user, dto.branchId);
    await this.requireActiveSupplier(dto.supplierId);
    await this.requireWarehouse(dto.destinationWarehouseId, dto.branchId);
    const prepared = await this.prepareLines(dto.lines);

    const orderDate = this.toDate(
      dto.orderDate ?? new Date().toISOString(),
    );
    const expectedDeliveryDate = dto.expectedDate
      ? this.toDate(dto.expectedDate)
      : null;
    if (expectedDeliveryDate && expectedDeliveryDate < orderDate) {
      throw AppException.validation([
        {
          field: 'expectedDate',
          message: 'Expected delivery date cannot be before the order date.',
        },
      ]);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const year = orderDate.getUTCFullYear();
      const sequence = await this.sequences.next(
        tx,
        purchaseOrderSequenceKey(year),
      );
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber: formatPurchaseOrderNumber(year, sequence),
          supplierId: dto.supplierId,
          branchId: dto.branchId,
          destinationWarehouseId: dto.destinationWarehouseId,
          status: PurchaseOrderStatus.DRAFT,
          orderDate,
          expectedDeliveryDate,
          currencyCode: dto.currency?.toUpperCase() ?? 'PHP',
          subtotal: prepared.totals.subtotal,
          discountTotal: prepared.totals.discountTotal,
          taxTotal: prepared.totals.taxTotal,
          grandTotal: prepared.totals.grandTotal,
          terms: dto.terms ?? null,
          notes: dto.notes ?? null,
          createdById: user.id,
        },
        select: { id: true, poNumber: true },
      });
      await this.writeLines(tx, po.id, prepared.lines);
      return po;
    });

    await this.audit.log({
      action: 'purchase_order.created',
      resourceType: 'purchase_order',
      resourceId: created.id,
      branchId: dto.branchId,
      newValues: {
        poNumber: created.poNumber,
        supplierId: dto.supplierId,
        lineCount: dto.lines.length,
        grandTotal: prepared.totals.grandTotal.toString(),
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdatePurchaseOrderDto,
    ctx: AuditContext,
  ): Promise<PurchaseOrderDetailView> {
    const existing = await this.requirePo(user, id);
    if (!canTransitionPo(existing.status, 'update')) {
      throw AppException.invalidStateTransition(
        poTransitionError(existing.status, 'update'),
      );
    }
    if (dto.supplierId && dto.supplierId !== existing.supplierId) {
      await this.requireActiveSupplier(dto.supplierId);
    }
    const prepared = dto.lines ? await this.prepareLines(dto.lines) : null;

    const orderDate = dto.orderDate
      ? this.toDate(dto.orderDate)
      : existing.orderDate;
    const expectedDeliveryDate =
      dto.expectedDate !== undefined
        ? dto.expectedDate
          ? this.toDate(dto.expectedDate)
          : null
        : existing.expectedDeliveryDate;
    if (expectedDeliveryDate && expectedDeliveryDate < orderDate) {
      throw AppException.validation([
        {
          field: 'expectedDate',
          message: 'Expected delivery date cannot be before the order date.',
        },
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, version: dto.version, status: PurchaseOrderStatus.DRAFT },
        data: {
          ...(dto.supplierId !== undefined
            ? { supplierId: dto.supplierId }
            : {}),
          ...(dto.orderDate ? { orderDate } : {}),
          ...(dto.expectedDate !== undefined ? { expectedDeliveryDate } : {}),
          ...(dto.currency
            ? { currencyCode: dto.currency.toUpperCase() }
            : {}),
          ...(dto.terms !== undefined ? { terms: dto.terms } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(prepared
            ? {
                subtotal: prepared.totals.subtotal,
                discountTotal: prepared.totals.discountTotal,
                taxTotal: prepared.totals.taxTotal,
                grandTotal: prepared.totals.grandTotal,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.versionConflict();
      }
      if (prepared) {
        await tx.purchaseOrderLine.deleteMany({
          where: { purchaseOrderId: id },
        });
        await this.writeLines(tx, id, prepared.lines);
      }
    });

    await this.audit.log({
      action: 'purchase_order.updated',
      resourceType: 'purchase_order',
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
  ): Promise<PurchaseOrderDetailView> {
    const po = await this.requirePo(user, id);
    if (!canTransitionPo(po.status, 'submit')) {
      throw AppException.invalidStateTransition(
        poTransitionError(po.status, 'submit'),
      );
    }
    await this.requireActiveSupplier(po.supplierId);
    const lineCount = await this.prisma.purchaseOrderLine.count({
      where: { purchaseOrderId: id },
    });
    if (lineCount === 0) {
      throw AppException.validation([
        {
          field: 'lines',
          message:
            'A purchase order needs at least one line before submission.',
        },
      ]);
    }

    // Approval engine arrives in Phase 6. Until a matching active workflow
    // exists for this resource/branch, submit auto-advances to APPROVED
    // (docs/status-transitions.md §3) and the document records why —
    // mirroring stock transactions.
    const workflow = await this.prisma.approvalWorkflow.findFirst({
      where: {
        resourceType: 'PURCHASE_ORDER',
        isActive: true,
        OR: [{ branchId: null }, { branchId: po.branchId }],
      },
      select: { id: true },
    });
    const now = new Date();
    const autoApproved = !workflow;
    const claimed = await this.prisma.purchaseOrder.updateMany({
      where: { id, status: PurchaseOrderStatus.DRAFT },
      data: {
        status: autoApproved
          ? PurchaseOrderStatus.APPROVED
          : PurchaseOrderStatus.PENDING_APPROVAL,
        submittedAt: now,
        ...(autoApproved
          ? {
              approvedById: user.id,
              approvedAt: now,
              notes: this.appendNote(
                po.notes,
                '[auto-approved on submit: no approval workflow configured — approval engine arrives in Phase 6]',
              ),
            }
          : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The purchase order was modified concurrently. Refetch and retry.',
      );
    }

    await this.audit.log({
      action: autoApproved
        ? 'purchase_order.submitted_auto_approved'
        : 'purchase_order.submitted',
      resourceType: 'purchase_order',
      resourceId: id,
      branchId: po.branchId,
      oldValues: { status: po.status },
      newValues: {
        status: autoApproved
          ? PurchaseOrderStatus.APPROVED
          : PurchaseOrderStatus.PENDING_APPROVAL,
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
  ): Promise<PurchaseOrderDetailView> {
    const po = await this.requirePo(user, id);
    if (!canTransitionPo(po.status, 'approve')) {
      throw AppException.invalidStateTransition(
        poTransitionError(po.status, 'approve'),
      );
    }
    this.assertNotSelfApproval(user, po.createdById);

    const claimed = await this.prisma.purchaseOrder.updateMany({
      where: { id, status: PurchaseOrderStatus.PENDING_APPROVAL },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
        ...(comment
          ? { notes: this.appendNote(po.notes, `[approval: ${comment}]`) }
          : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The purchase order was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'purchase_order.approved',
      resourceType: 'purchase_order',
      resourceId: id,
      branchId: po.branchId,
      oldValues: { status: po.status },
      newValues: {
        status: PurchaseOrderStatus.APPROVED,
        comment: comment ?? null,
      },
      ...ctx,
    });
    return this.getById(user, id);
  }

  /**
   * Reject returns the PO to DRAFT for revision — the machine has no resting
   * Rejected state (docs/status-transitions.md §3). The comment lands in the
   * notes and the audit trail.
   */
  async reject(
    user: AuthUser,
    id: string,
    comment: string,
    ctx: AuditContext,
  ): Promise<PurchaseOrderDetailView> {
    const po = await this.requirePo(user, id);
    if (!canTransitionPo(po.status, 'reject')) {
      throw AppException.invalidStateTransition(
        poTransitionError(po.status, 'reject'),
      );
    }
    this.assertNotSelfApproval(user, po.createdById);

    const claimed = await this.prisma.purchaseOrder.updateMany({
      where: { id, status: PurchaseOrderStatus.PENDING_APPROVAL },
      data: {
        status: PurchaseOrderStatus.DRAFT,
        submittedAt: null,
        notes: this.appendNote(po.notes, `[rejected: ${comment}]`),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The purchase order was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'purchase_order.rejected',
      resourceType: 'purchase_order',
      resourceId: id,
      branchId: po.branchId,
      oldValues: { status: po.status },
      newValues: { status: PurchaseOrderStatus.DRAFT },
      reason: comment,
      ...ctx,
    });
    return this.getById(user, id);
  }

  async cancel(
    user: AuthUser,
    id: string,
    reason: string,
    ctx: AuditContext,
  ): Promise<PurchaseOrderDetailView> {
    const po = await this.requirePo(user, id);
    if (!canTransitionPo(po.status, 'cancel')) {
      throw AppException.invalidStateTransition(
        poTransitionError(po.status, 'cancel'),
      );
    }
    // Once anything has been received (or a receipt is drafted/posted) the
    // remedy is close-short, never cancel (docs/status-transitions.md §3).
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: {
        purchaseOrderId: id,
        status: { in: [GoodsReceiptStatus.DRAFT, GoodsReceiptStatus.POSTED] },
      },
      select: { receiptNumber: true, status: true },
    });
    if (receipt) {
      throw AppException.invalidStateTransition(
        `Cannot cancel: goods receipt ${receipt.receiptNumber} (${receipt.status}) exists against this PO. ` +
          'Cancel the draft receipt first, or close the PO short once stock has been received.',
      );
    }

    const claimed = await this.prisma.purchaseOrder.updateMany({
      where: { id, status: po.status },
      data: {
        status: PurchaseOrderStatus.CANCELED,
        canceledById: user.id,
        canceledAt: new Date(),
        notes: this.appendNote(po.notes, `[canceled: ${reason}]`),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The purchase order was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'purchase_order.canceled',
      resourceType: 'purchase_order',
      resourceId: id,
      branchId: po.branchId,
      oldValues: { status: po.status },
      newValues: { status: PurchaseOrderStatus.CANCELED },
      reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  /**
   * Close a PO whose remaining quantities will not arrive (close-short from
   * PARTIALLY_RECEIVED) or that is fully received. Outstanding quantities are
   * explicitly written to each line's canceledQuantity.
   */
  async close(
    user: AuthUser,
    id: string,
    reason: string,
    ctx: AuditContext,
  ): Promise<PurchaseOrderDetailView> {
    const po = await this.requirePo(user, id);
    if (!canTransitionPo(po.status, 'close')) {
      throw AppException.invalidStateTransition(
        poTransitionError(po.status, 'close'),
      );
    }
    const draftReceipt = await this.prisma.goodsReceipt.findFirst({
      where: { purchaseOrderId: id, status: GoodsReceiptStatus.DRAFT },
      select: { receiptNumber: true },
    });
    if (draftReceipt) {
      throw AppException.invalidStateTransition(
        `Cannot close: draft goods receipt ${draftReceipt.receiptNumber} is still in flight. Post or cancel it first.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, status: po.status },
        data: {
          status: PurchaseOrderStatus.CLOSED,
          closedAt: new Date(),
          notes: this.appendNote(po.notes, `[closed: ${reason}]`),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.invalidStateTransition(
          'The purchase order was modified concurrently. Refetch and retry.',
        );
      }
      const lines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: id },
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
          canceledQuantity: true,
        },
      });
      for (const line of lines) {
        const outstanding = outstandingQuantity(line);
        if (outstanding.gt(0)) {
          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: {
              canceledQuantity: line.canceledQuantity.add(outstanding),
            },
          });
        }
      }
    });

    await this.audit.log({
      action: 'purchase_order.closed',
      resourceType: 'purchase_order',
      resourceId: id,
      branchId: po.branchId,
      oldValues: { status: po.status },
      newValues: { status: PurchaseOrderStatus.CLOSED },
      reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Line preparation (validation + Decimal money math)
  // -------------------------------------------------------------------------

  private async prepareLines(
    lines: PurchaseOrderLineDto[],
  ): Promise<PreparedPoLines> {
    const errors: ApiErrorDetail[] = [];
    const itemIds = [...new Set(lines.map((line) => line.itemId))];
    const uomIds = [...new Set(lines.map((line) => line.uomId))];

    const [items, uoms, globalConversions] = await Promise.all([
      this.prisma.item.findMany({
        where: { id: { in: itemIds } },
        select: {
          id: true,
          sku: true,
          isActive: true,
          archivedAt: true,
          baseUomId: true,
          trackingMethod: true,
          categoryId: true,
          uomConversions: {
            select: { fromUomId: true, toUomId: true, factor: true },
          },
        },
      }),
      this.prisma.unitOfMeasure.findMany({
        where: { id: { in: uomIds } },
        select: { id: true, isActive: true },
      }),
      this.prisma.uomConversion.findMany({
        where: { itemId: null },
        select: { fromUomId: true, toUomId: true, factor: true },
      }),
    ]);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const uomById = new Map(uoms.map((uom) => [uom.id, uom]));

    const prepared: PreparedPoLine[] = [];
    lines.forEach((line, index) => {
      const field = (name: string) => `lines[${index}].${name}`;
      const item = itemById.get(line.itemId);
      if (!item || item.archivedAt) {
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
      if (item.trackingMethod === 'SERIAL' && !item.categoryId) {
        errors.push({
          field: field('itemId'),
          message: `${item.sku} is serialized but has no item category — the category code is required for asset tags at receiving.`,
        });
        return;
      }
      const uom = uomById.get(line.uomId);
      if (!uom || !uom.isActive) {
        errors.push({
          field: field('uomId'),
          message: 'UOM does not exist or is inactive.',
        });
        return;
      }
      // Receipts normalize to base units at posting — fail early when no
      // conversion path exists instead of at the warehouse door.
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

      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.lte(0)) {
        errors.push({
          field: field('quantity'),
          message: 'Quantity must be greater than zero.',
        });
        return;
      }
      if (
        item.trackingMethod === 'SERIAL' &&
        !quantity.isInteger()
      ) {
        errors.push({
          field: field('quantity'),
          message: `${item.sku} is serialized — the quantity must be a whole number of units.`,
        });
        return;
      }
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      const discountAmount = new Prisma.Decimal(line.discount ?? 0);
      const taxAmount = new Prisma.Decimal(line.tax ?? 0);
      const amounts = computeLineAmounts({
        quantity,
        unitPrice,
        discountAmount,
        taxAmount,
      });
      if (discountAmount.gt(amounts.gross)) {
        errors.push({
          field: field('discount'),
          message: `Discount (${discountAmount.toString()}) exceeds the line amount (${amounts.gross.toString()}).`,
        });
        return;
      }

      prepared.push({
        ...amounts,
        itemId: item.id,
        uomId: line.uomId,
        description: line.description ?? null,
        notes: line.notes ?? null,
      });
    });

    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
    return { lines: prepared, totals: computeDocumentTotals(prepared) };
  }

  private async writeLines(
    tx: Prisma.TransactionClient,
    purchaseOrderId: string,
    lines: PreparedPoLine[],
  ): Promise<void> {
    let lineNumber = 0;
    for (const line of lines) {
      lineNumber += 1;
      await tx.purchaseOrderLine.create({
        data: {
          purchaseOrderId,
          lineNumber,
          itemId: line.itemId,
          description: line.description,
          uomId: line.uomId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          notes: line.notes,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private assertNotSelfApproval(user: AuthUser, createdById: string): void {
    if (createdById === user.id) {
      throw new AppException(
        409,
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot approve or reject your own purchase order.',
      );
    }
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
          message: `Supplier ${supplier.code} is inactive — reactivate it before ordering.`,
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
          field: 'destinationWarehouseId',
          message: 'Warehouse does not exist or is inactive.',
        },
      ]);
    }
    if (warehouse.branchId !== branchId) {
      throw AppException.validation([
        {
          field: 'destinationWarehouseId',
          message: 'Warehouse belongs to a different branch.',
        },
      ]);
    }
  }

  private async requirePo(user: AuthUser, id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        branchId: true,
        supplierId: true,
        createdById: true,
        notes: true,
        orderDate: true,
        expectedDeliveryDate: true,
      },
    });
    if (!po || !this.branchScope.canAccess(user, po.branchId)) {
      throw AppException.notFound('Purchase order not found.');
    }
    return po;
  }

  private appendNote(notes: string | null, addition: string): string {
    return notes ? `${notes}\n${addition}` : addition;
  }

  private toDate(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
