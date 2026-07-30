import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Paginated } from '@gemerp/shared';
import {
  EmployeeStatus,
  Prisma,
  StockDocumentStatus,
  StockTransactionType,
  TrackingMethod,
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
  formatLotNumber,
  formatStockTransactionNumber,
  lotSequenceKey,
  stockTransactionSequenceKey,
} from './inventory-numbers';
import {
  canTransition,
  directionOf,
  MovementDirection,
  REASON_REQUIRED_TYPES,
  SYSTEM_GENERATED_TYPES,
  transitionError,
  TYPE_CREATE_PERMISSION,
} from './stock-transaction-rules';
import {
  canViewInventoryCost,
  STOCK_TXN_DETAIL_SELECT,
  STOCK_TXN_LIST_SELECT,
  StockTransactionDetailView,
  StockTransactionView,
  toStockTransactionDetailView,
  toStockTransactionView,
} from './stock-transaction-views';
import {
  CreateStockTransactionDto,
  LotInputDto,
  StockTransactionLineDto,
} from './dto/create-stock-transaction.dto';
import { QueryStockTransactionsDto } from './dto/query-stock-transactions.dto';
import {
  ApproveStockTransactionDto,
  CancelStockTransactionDto,
  RejectStockTransactionDto,
} from './dto/stock-transaction-actions.dto';
import { UpdateStockTransactionDto } from './dto/update-stock-transaction.dto';

const SORTABLE = {
  transactionNumber: 'transactionNumber',
  transactionDate: 'transactionDate',
  type: 'type',
  status: 'status',
  createdAt: 'createdAt',
  postedAt: 'postedAt',
};

/** Reason lookups a stock transaction may reference. */
const REASON_CATEGORIES = [
  'TRANSACTION_REASON',
  'ADJUSTMENT_REASON',
  'DISPOSAL_METHOD',
];

interface PreparedLine {
  itemId: string;
  lotId: string | null;
  pendingLot: { itemSku: string; input: LotInputDto } | null;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  enteredUomId: string;
  enteredQuantity: Prisma.Decimal;
  baseQuantity: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
  totalCost: Prisma.Decimal | null;
  notes: string | null;
}

@Injectable()
export class StockTransactionsService {
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
    query: QueryStockTransactionsDto,
  ): Promise<Paginated<StockTransactionView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });

    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }
    const where: Prisma.StockTransactionWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
    };
    if (query.type) {
      where.type = query.type;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.warehouseId) {
      where.OR = [
        { sourceWarehouseId: query.warehouseId },
        { destinationWarehouseId: query.warehouseId },
      ];
    }
    if (query.itemId) {
      where.lines = { some: { itemId: query.itemId } };
    }
    if (query.number) {
      where.transactionNumber = { contains: query.number, mode: 'insensitive' };
    }
    if (query.from || query.to) {
      where.transactionDate = {
        ...(query.from ? { gte: this.toDate(query.from) } : {}),
        ...(query.to ? { lte: this.toDate(query.to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.stockTransaction.findMany({
        where,
        orderBy,
        skip,
        take,
        select: STOCK_TXN_LIST_SELECT,
      }),
      this.prisma.stockTransaction.count({ where }),
    ]);
    return paginated(rows.map(toStockTransactionView), page, pageSize, total);
  }

  async getById(
    user: AuthUser,
    id: string,
  ): Promise<StockTransactionDetailView> {
    const row = await this.prisma.stockTransaction.findUnique({
      where: { id },
      select: STOCK_TXN_DETAIL_SELECT,
    });
    if (!row || !this.branchScope.canAccess(user, row.branch.id)) {
      throw AppException.notFound('Stock transaction not found.');
    }
    return toStockTransactionDetailView(row, canViewInventoryCost(user));
  }

  // -------------------------------------------------------------------------
  // Create / update drafts
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreateStockTransactionDto,
    ctx: AuditContext,
  ): Promise<StockTransactionDetailView> {
    if (SYSTEM_GENERATED_TYPES.includes(dto.type)) {
      throw AppException.validation([
        {
          field: 'type',
          message: `${dto.type} transactions are system-generated (transfer flow / reverse endpoint) and cannot be created directly.`,
        },
      ]);
    }
    this.assertTypePermission(user, dto.type);
    this.branchScope.assertBranchAccess(user, dto.branchId);
    const direction = directionOf(dto.type) as MovementDirection;

    const warehouse = await this.requireWarehouse(
      dto.warehouseId,
      dto.branchId,
      'warehouseId',
    );
    let destinationWarehouseId: string | null = null;
    if (direction === 'MOVE') {
      destinationWarehouseId = dto.destinationWarehouseId ?? warehouse.id;
      if (destinationWarehouseId !== warehouse.id) {
        await this.requireWarehouse(
          destinationWarehouseId,
          dto.branchId,
          'destinationWarehouseId',
        );
      }
    } else if (dto.destinationWarehouseId) {
      throw AppException.validation([
        {
          field: 'destinationWarehouseId',
          message: 'destinationWarehouseId applies only to LOCATION_TRANSFER.',
        },
      ]);
    }

    const reasonId = await this.resolveReason(dto.type, dto.reasonId, dto.reasonCode);
    await this.validateTypeReferences(dto.type, dto);
    const prepared = await this.prepareLines(
      direction,
      warehouse.id,
      destinationWarehouseId ?? warehouse.id,
      dto.lines,
    );

    const transactionDate = this.toDate(
      dto.transactionDate ?? new Date().toISOString(),
    );
    const created = await this.prisma.$transaction(async (tx) => {
      const year = transactionDate.getUTCFullYear();
      const sequence = await this.sequences.next(
        tx,
        stockTransactionSequenceKey(year),
      );
      const txn = await tx.stockTransaction.create({
        data: {
          transactionNumber: formatStockTransactionNumber(year, sequence),
          type: dto.type,
          status: StockDocumentStatus.DRAFT,
          transactionDate,
          branchId: dto.branchId,
          sourceWarehouseId: direction === 'IN' ? null : warehouse.id,
          destinationWarehouseId:
            direction === 'IN' ? warehouse.id : destinationWarehouseId,
          employeeId: dto.employeeId ?? null,
          departmentId: dto.departmentId ?? null,
          supplierId: dto.supplierId ?? null,
          workOrderId: dto.workOrderId ?? null,
          projectRef: dto.projectRef ?? null,
          reasonId,
          notes: dto.notes ?? null,
          createdById: user.id,
        },
        select: { id: true, transactionNumber: true },
      });
      await this.writeLines(tx, txn.id, prepared);
      return txn;
    });

    await this.audit.log({
      action: 'stock_transaction.created',
      resourceType: 'stock_transaction',
      resourceId: created.id,
      branchId: dto.branchId,
      newValues: {
        transactionNumber: created.transactionNumber,
        type: dto.type,
        lineCount: dto.lines.length,
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateStockTransactionDto,
    ctx: AuditContext,
  ): Promise<StockTransactionDetailView> {
    const existing = await this.requireTxn(user, id);
    if (!canTransition(existing.status, 'update')) {
      throw AppException.invalidStateTransition(
        transitionError(existing.status, 'update'),
      );
    }
    this.assertTypePermission(user, existing.type);
    const direction = directionOf(existing.type) as MovementDirection;

    const merged = {
      employeeId: dto.employeeId ?? existing.employeeId ?? undefined,
      departmentId: dto.departmentId ?? existing.departmentId ?? undefined,
      supplierId: dto.supplierId ?? existing.supplierId ?? undefined,
    };
    await this.validateTypeReferences(existing.type, merged);
    const reasonId =
      dto.reasonId !== undefined || dto.reasonCode !== undefined
        ? await this.resolveReason(existing.type, dto.reasonId, dto.reasonCode)
        : undefined;

    const sourceWarehouseId = existing.sourceWarehouseId;
    const destinationWarehouseId = existing.destinationWarehouseId;
    const prepared = dto.lines
      ? await this.prepareLines(
          direction,
          (direction === 'IN' ? destinationWarehouseId : sourceWarehouseId) as string,
          (destinationWarehouseId ?? sourceWarehouseId) as string,
          dto.lines,
        )
      : null;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockTransaction.updateMany({
        where: { id, version: dto.version, status: StockDocumentStatus.DRAFT },
        data: {
          ...(dto.transactionDate
            ? { transactionDate: this.toDate(dto.transactionDate) }
            : {}),
          ...(dto.employeeId !== undefined ? { employeeId: dto.employeeId } : {}),
          ...(dto.departmentId !== undefined
            ? { departmentId: dto.departmentId }
            : {}),
          ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
          ...(dto.workOrderId !== undefined
            ? { workOrderId: dto.workOrderId }
            : {}),
          ...(dto.projectRef !== undefined ? { projectRef: dto.projectRef } : {}),
          ...(reasonId !== undefined ? { reasonId } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.versionConflict();
      }
      if (prepared) {
        await tx.stockTransactionLine.deleteMany({ where: { transactionId: id } });
        await this.writeLines(tx, id, prepared);
      }
    });

    await this.audit.log({
      action: 'stock_transaction.updated',
      resourceType: 'stock_transaction',
      resourceId: id,
      branchId: existing.branchId,
      oldValues: { version: dto.version },
      newValues: { linesReplaced: Boolean(prepared) },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Workflow actions (submit / approve / reject / cancel)
  // -------------------------------------------------------------------------

  async submit(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<StockTransactionDetailView> {
    const txn = await this.requireTxn(user, id);
    if (!canTransition(txn.status, 'submit')) {
      throw AppException.invalidStateTransition(transitionError(txn.status, 'submit'));
    }
    const lineCount = await this.prisma.stockTransactionLine.count({
      where: { transactionId: id },
    });
    if (lineCount === 0) {
      throw AppException.validation([
        { field: 'lines', message: 'A transaction needs at least one line before submission.' },
      ]);
    }

    // Approval engine arrives in Phase 6. Until a matching active workflow
    // exists for this resource/branch, submit auto-advances to APPROVED
    // (docs/status-transitions.md §2) and the document records why.
    const workflow = await this.prisma.approvalWorkflow.findFirst({
      where: {
        resourceType: 'STOCK_TRANSACTION',
        isActive: true,
        OR: [{ branchId: null }, { branchId: txn.branchId }],
      },
      select: { id: true },
    });
    const now = new Date();
    const autoApproved = !workflow;
    const claimed = await this.prisma.stockTransaction.updateMany({
      where: { id, status: StockDocumentStatus.DRAFT },
      data: {
        status: autoApproved
          ? StockDocumentStatus.APPROVED
          : StockDocumentStatus.PENDING_APPROVAL,
        submittedAt: now,
        ...(autoApproved
          ? {
              approvedById: user.id,
              approvedAt: now,
              notes: this.appendNote(
                txn.notes,
                '[auto-approved on submit: no approval workflow configured — approval engine arrives in Phase 6]',
              ),
            }
          : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The transaction was modified concurrently. Refetch and retry.',
      );
    }

    await this.audit.log({
      action: autoApproved
        ? 'stock_transaction.submitted_auto_approved'
        : 'stock_transaction.submitted',
      resourceType: 'stock_transaction',
      resourceId: id,
      branchId: txn.branchId,
      oldValues: { status: txn.status },
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
    dto: ApproveStockTransactionDto,
    ctx: AuditContext,
  ): Promise<StockTransactionDetailView> {
    const txn = await this.requireTxn(user, id);
    if (!canTransition(txn.status, 'approve')) {
      throw AppException.invalidStateTransition(transitionError(txn.status, 'approve'));
    }
    this.assertNotSelfApproval(user, txn.createdById);

    const claimed = await this.prisma.stockTransaction.updateMany({
      where: { id, status: StockDocumentStatus.PENDING_APPROVAL },
      data: {
        status: StockDocumentStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
        ...(dto.comment
          ? { notes: this.appendNote(txn.notes, `[approval: ${dto.comment}]`) }
          : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The transaction was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'stock_transaction.approved',
      resourceType: 'stock_transaction',
      resourceId: id,
      branchId: txn.branchId,
      oldValues: { status: txn.status },
      newValues: { status: StockDocumentStatus.APPROVED, comment: dto.comment ?? null },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async reject(
    user: AuthUser,
    id: string,
    dto: RejectStockTransactionDto,
    ctx: AuditContext,
  ): Promise<StockTransactionDetailView> {
    const txn = await this.requireTxn(user, id);
    if (!canTransition(txn.status, 'reject')) {
      throw AppException.invalidStateTransition(transitionError(txn.status, 'reject'));
    }
    this.assertNotSelfApproval(user, txn.createdById);

    const claimed = await this.prisma.stockTransaction.updateMany({
      where: { id, status: StockDocumentStatus.PENDING_APPROVAL },
      data: {
        status: StockDocumentStatus.REJECTED,
        notes: this.appendNote(txn.notes, `[rejected: ${dto.comment}]`),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The transaction was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'stock_transaction.rejected',
      resourceType: 'stock_transaction',
      resourceId: id,
      branchId: txn.branchId,
      oldValues: { status: txn.status },
      newValues: { status: StockDocumentStatus.REJECTED },
      reason: dto.comment,
      ...ctx,
    });
    return this.getById(user, id);
  }

  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelStockTransactionDto,
    ctx: AuditContext,
  ): Promise<StockTransactionDetailView> {
    const txn = await this.requireTxn(user, id);
    if (!canTransition(txn.status, 'cancel')) {
      throw AppException.invalidStateTransition(transitionError(txn.status, 'cancel'));
    }
    if (txn.transferId) {
      throw AppException.invalidStateTransition(
        'Transfer-leg transactions are canceled through the transfer document.',
      );
    }

    const claimed = await this.prisma.stockTransaction.updateMany({
      where: { id, status: txn.status },
      data: {
        status: StockDocumentStatus.CANCELED,
        canceledById: user.id,
        canceledAt: new Date(),
        notes: this.appendNote(txn.notes, `[canceled: ${dto.reason}]`),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The transaction was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'stock_transaction.canceled',
      resourceType: 'stock_transaction',
      resourceId: id,
      branchId: txn.branchId,
      oldValues: { status: txn.status },
      newValues: { status: StockDocumentStatus.CANCELED },
      reason: dto.reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Line preparation (validation + UOM normalization + lot resolution)
  // -------------------------------------------------------------------------

  /**
   * Validates lines and normalizes entered quantities into base units using
   * the Phase 2 UOM conversion graph (item-specific conversions win over
   * global ones). Lots are resolved but only *created* later inside the
   * document's own database transaction.
   */
  private async prepareLines(
    direction: MovementDirection,
    primaryWarehouseId: string,
    destinationWarehouseId: string,
    lines: StockTransactionLineDto[],
  ): Promise<PreparedLine[]> {
    const errors: ApiErrorDetail[] = [];
    const itemIds = [...new Set(lines.map((line) => line.itemId))];
    const lotIds = [
      ...new Set(lines.map((line) => line.lotId).filter((v): v is string => !!v)),
    ];
    const locationIds = [
      ...new Set(
        lines
          .flatMap((line) => [line.locationId, line.destinationLocationId])
          .filter((v): v is string => !!v),
      ),
    ];

    // Location fallbacks (spec §6 default receiving/issuance locations):
    // receipts default to the warehouse's receiving location; issues without a
    // location auto-resolve when exactly one location holds the item's stock.
    const wantsReceiptDefault =
      direction === 'IN' && lines.some((line) => !line.locationId);
    const autoSourceItemIds =
      direction === 'OUT'
        ? [...new Set(lines.filter((line) => !line.locationId).map((line) => line.itemId))]
        : [];

    const [items, globalConversions, lots, locations, defaultLocRow, sourceBuckets] = await Promise.all([
      this.prisma.item.findMany({
        where: { id: { in: itemIds } },
        select: {
          id: true,
          sku: true,
          name: true,
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
      wantsReceiptDefault
        ? this.prisma.warehouse.findUnique({
            where: { id: primaryWarehouseId },
            select: { defaultReceivingLocationId: true },
          })
        : Promise.resolve(null),
      autoSourceItemIds.length > 0
        ? this.prisma.stockBalance.findMany({
            where: {
              warehouseId: primaryWarehouseId,
              itemId: { in: autoSourceItemIds },
            },
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
    const defaultReceivingLocationId =
      defaultLocRow?.defaultReceivingLocationId ?? null;
    const itemById = new Map(items.map((item) => [item.id, item]));
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));
    const locationById = new Map(locations.map((location) => [location.id, location]));

    const prepared: PreparedLine[] = [];
    lines.forEach((line, index) => {
      const field = (name: string) => `lines[${index}].${name}`;
      const item = itemById.get(line.itemId);
      if (!item) {
        errors.push({ field: field('itemId'), message: 'Item does not exist.' });
        return;
      }
      if (!item.isActive) {
        errors.push({ field: field('itemId'), message: `Item ${item.sku} is inactive.` });
        return;
      }
      if (item.trackingMethod === TrackingMethod.SERIAL) {
        errors.push({
          field: field('itemId'),
          message: `${item.sku} is serialized — individual assets move through the assets module, not quantity stock transactions.`,
        });
        return;
      }

      // Lot rules (spec §13): LOT items always move with a lot reference.
      let lotId: string | null = null;
      let pendingLot: PreparedLine['pendingLot'] = null;
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
          if (direction !== 'IN') {
            errors.push({
              field: field('lotInput'),
              message: 'Inline lot creation is only valid on receipts; issues must reference an existing lot (lotId).',
            });
            return;
          }
          if (item.isExpiryTracked && !line.lotInput.expiryDate) {
            errors.push({
              field: field('lotInput.expiryDate'),
              message: `${item.sku} is expiry-tracked: expiryDate is required.`,
            });
            return;
          }
          pendingLot = { itemSku: item.sku, input: line.lotInput };
        } else {
          errors.push({
            field: field('lotId'),
            message: `${item.sku} is LOT-tracked: provide lotId${direction === 'IN' ? ' or lotInput' : ''}.`,
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

      // Locations must belong to the warehouse of the side they act on.
      const checkLocation = (
        locationId: string | undefined,
        expectedWarehouseId: string,
        name: string,
      ): string | null => {
        if (!locationId) {
          return null;
        }
        const location = locationById.get(locationId);
        if (!location || !location.isActive) {
          errors.push({ field: field(name), message: 'Storage location does not exist or is inactive.' });
          return null;
        }
        if (location.warehouseId !== expectedWarehouseId) {
          errors.push({
            field: field(name),
            message: 'Storage location belongs to a different warehouse.',
          });
          return null;
        }
        return location.id;
      };

      let sourceLocationId: string | null = null;
      let destinationLocationId: string | null = null;
      if (direction === 'IN') {
        destinationLocationId = line.locationId
          ? checkLocation(line.locationId, primaryWarehouseId, 'locationId')
          : defaultReceivingLocationId;
        if (line.destinationLocationId) {
          errors.push({
            field: field('destinationLocationId'),
            message: 'Use locationId for the receiving location on inbound types.',
          });
        }
      } else if (direction === 'OUT') {
        if (line.locationId) {
          sourceLocationId = checkLocation(line.locationId, primaryWarehouseId, 'locationId');
        } else {
          const candidates = [
            ...new Set(
              sourceBuckets
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
            sourceLocationId = candidates[0];
          } else if (candidates.length > 1) {
            errors.push({
              field: field('locationId'),
              message: `${item.sku} is stocked in multiple locations of this warehouse — specify locationId.`,
            });
            return;
          }
          // Zero candidates: leave null — posting reports INSUFFICIENT_STOCK.
        }
        if (line.destinationLocationId) {
          errors.push({
            field: field('destinationLocationId'),
            message: 'destinationLocationId applies only to LOCATION_TRANSFER.',
          });
        }
      } else {
        if (!line.locationId || !line.destinationLocationId) {
          errors.push({
            field: field(line.locationId ? 'destinationLocationId' : 'locationId'),
            message: 'LOCATION_TRANSFER lines need both locationId (source) and destinationLocationId.',
          });
          return;
        }
        sourceLocationId = checkLocation(line.locationId, primaryWarehouseId, 'locationId');
        destinationLocationId = checkLocation(
          line.destinationLocationId,
          destinationWarehouseId,
          'destinationLocationId',
        );
        if (
          sourceLocationId &&
          destinationLocationId &&
          primaryWarehouseId === destinationWarehouseId &&
          sourceLocationId === destinationLocationId
        ) {
          errors.push({
            field: field('destinationLocationId'),
            message: 'Source and destination locations are identical.',
          });
          return;
        }
      }

      // UOM normalization (spec §5): entered qty + normalized base qty.
      const enteredQuantity = new Prisma.Decimal(line.quantity);
      if (enteredQuantity.lte(0)) {
        errors.push({ field: field('quantity'), message: 'Quantity must be greater than zero.' });
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
      const baseQuantity = enteredQuantity
        .mul(new Prisma.Decimal(factor.toString()))
        .toDecimalPlaces(4);
      if (baseQuantity.lte(0)) {
        errors.push({
          field: field('quantity'),
          message: 'Normalized base quantity rounds to zero — use a larger quantity or a smaller unit.',
        });
        return;
      }

      const unitCost = line.unitCost ? new Prisma.Decimal(line.unitCost) : null;
      prepared.push({
        itemId: item.id,
        lotId,
        pendingLot,
        sourceLocationId,
        destinationLocationId,
        enteredUomId: line.uomId,
        enteredQuantity,
        baseQuantity,
        unitCost,
        totalCost: unitCost
          ? unitCost.mul(enteredQuantity).toDecimalPlaces(2)
          : null,
        notes: line.notes ?? null,
      });
    });

    if (errors.length > 0) {
      throw AppException.validation(errors);
    }

    // Entered UOMs must exist (conversion lookup alone can miss identity units).
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

  /** Materializes pending lots and writes the line rows (inside the doc tx). */
  private async writeLines(
    tx: Prisma.TransactionClient,
    transactionId: string,
    prepared: PreparedLine[],
  ): Promise<void> {
    let lineNumber = 0;
    for (const line of prepared) {
      lineNumber += 1;
      let lotId = line.lotId;
      if (line.pendingLot) {
        lotId = await this.resolveLot(tx, line.itemId, line.pendingLot);
      }
      await tx.stockTransactionLine.create({
        data: {
          transactionId,
          lineNumber,
          itemId: line.itemId,
          lotId,
          sourceLocationId: line.sourceLocationId,
          destinationLocationId: line.destinationLocationId,
          enteredUomId: line.enteredUomId,
          enteredQuantity: line.enteredQuantity,
          baseQuantity: line.baseQuantity,
          unitCost: line.unitCost,
          totalCost: line.totalCost,
          notes: line.notes,
        },
      });
    }
  }

  /**
   * Find-or-create a lot for a receipt line. Auto-numbered lots follow
   * LOT-{SKU}-{YYYYMMDD}-{SEQ} from sequence_counters (api-outline 1.9).
   */
  private async resolveLot(
    tx: Prisma.TransactionClient,
    itemId: string,
    pending: { itemSku: string; input: LotInputDto },
  ): Promise<string> {
    const { input, itemSku } = pending;
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

  // -------------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------------

  private assertTypePermission(
    user: AuthUser,
    type: StockTransactionType,
  ): void {
    const permission = TYPE_CREATE_PERMISSION[type];
    if (!user.isSuperAdmin && !user.permissions.includes(permission)) {
      throw AppException.forbidden(
        `${type} transactions require the ${permission} permission.`,
      );
    }
  }

  private assertNotSelfApproval(user: AuthUser, createdById: string): void {
    if (createdById === user.id) {
      throw new AppException(
        409,
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot approve or reject your own transaction.',
      );
    }
  }

  private async requireWarehouse(
    warehouseId: string,
    branchId: string,
    field: string,
  ) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, branchId: true, isActive: true },
    });
    if (!warehouse || !warehouse.isActive) {
      throw AppException.validation([
        { field, message: 'Warehouse does not exist or is inactive.' },
      ]);
    }
    if (warehouse.branchId !== branchId) {
      throw AppException.validation([
        { field, message: 'Warehouse belongs to a different branch.' },
      ]);
    }
    return warehouse;
  }

  private async resolveReason(
    type: StockTransactionType,
    reasonId: string | undefined,
    reasonCode: string | undefined,
  ): Promise<string | null> {
    let resolved: string | null = null;
    if (reasonId) {
      const reason = await this.prisma.lookupValue.findFirst({
        where: { id: reasonId, isActive: true },
        select: { id: true },
      });
      if (!reason) {
        throw AppException.validation([
          { field: 'reasonId', message: 'Reason lookup value does not exist or is inactive.' },
        ]);
      }
      resolved = reason.id;
    } else if (reasonCode) {
      const reason = await this.prisma.lookupValue.findFirst({
        where: {
          code: reasonCode.toUpperCase(),
          category: { in: REASON_CATEGORIES },
          isActive: true,
        },
        select: { id: true },
      });
      if (!reason) {
        throw AppException.validation([
          {
            field: 'reasonCode',
            message: `No active reason lookup with code "${reasonCode}" (categories: ${REASON_CATEGORIES.join(', ')}).`,
          },
        ]);
      }
      resolved = reason.id;
    }
    if (!resolved && REASON_REQUIRED_TYPES.includes(type)) {
      throw AppException.validation([
        {
          field: 'reasonId',
          message: `${type} transactions require a reason (spec §25).`,
        },
      ]);
    }
    return resolved;
  }

  private async validateTypeReferences(
    type: StockTransactionType,
    refs: {
      employeeId?: string;
      departmentId?: string;
      supplierId?: string;
    },
  ): Promise<void> {
    const errors: ApiErrorDetail[] = [];
    const needsEmployee =
      type === StockTransactionType.ISSUE_TO_EMPLOYEE ||
      type === StockTransactionType.RETURN_FROM_EMPLOYEE;
    if (needsEmployee && !refs.employeeId) {
      errors.push({ field: 'employeeId', message: `${type} requires employeeId.` });
    }
    if (type === StockTransactionType.ISSUE_TO_DEPARTMENT && !refs.departmentId) {
      errors.push({ field: 'departmentId', message: `${type} requires departmentId.` });
    }
    if (type === StockTransactionType.RETURN_TO_SUPPLIER && !refs.supplierId) {
      errors.push({ field: 'supplierId', message: `${type} requires supplierId.` });
    }
    if (errors.length > 0) {
      throw AppException.validation(errors);
    }

    if (refs.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: refs.employeeId },
        select: { id: true, status: true },
      });
      if (!employee) {
        throw AppException.validation([
          { field: 'employeeId', message: 'Employee does not exist.' },
        ]);
      }
      if (
        type === StockTransactionType.ISSUE_TO_EMPLOYEE &&
        employee.status !== EmployeeStatus.ACTIVE
      ) {
        throw AppException.validation([
          { field: 'employeeId', message: 'Stock can only be issued to ACTIVE employees.' },
        ]);
      }
    }
    if (refs.departmentId) {
      const department = await this.prisma.department.findUnique({
        where: { id: refs.departmentId },
        select: { id: true },
      });
      if (!department) {
        throw AppException.validation([
          { field: 'departmentId', message: 'Department does not exist.' },
        ]);
      }
    }
    if (refs.supplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: refs.supplierId },
        select: { id: true },
      });
      if (!supplier) {
        throw AppException.validation([
          { field: 'supplierId', message: 'Supplier does not exist.' },
        ]);
      }
    }
  }

  private async requireTxn(user: AuthUser, id: string) {
    const txn = await this.prisma.stockTransaction.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        type: true,
        branchId: true,
        createdById: true,
        transferId: true,
        notes: true,
        employeeId: true,
        departmentId: true,
        supplierId: true,
        sourceWarehouseId: true,
        destinationWarehouseId: true,
      },
    });
    if (!txn || !this.branchScope.canAccess(user, txn.branchId)) {
      throw AppException.notFound('Stock transaction not found.');
    }
    return txn;
  }

  private appendNote(notes: string | null, addition: string): string {
    return notes ? `${notes}\n${addition}` : addition;
  }

  private toDate(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
