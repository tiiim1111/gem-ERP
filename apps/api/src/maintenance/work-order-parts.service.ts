import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail } from '@gemerp/shared';
import {
  MaintenanceWorkOrderStatus,
  Prisma,
  StockDocumentStatus,
  StockTransactionType,
  TrackingMethod,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import {
  formatStockTransactionNumber,
  stockTransactionSequenceKey,
} from '../inventory/inventory-numbers';
import { StockPostingService } from '../inventory/stock-posting.service';
import { conversionFactor } from '../items/uom-conversion.util';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  canTransitionWo,
  computeWorkOrderTotalCost,
  woTransitionError,
} from './work-order-rules';
import {
  canViewMaintenanceCost,
  toWorkOrderPartView,
  WO_PART_SELECT,
  WorkOrderPartView,
} from './maintenance-views';
import { CreatePartsIssueDto, PartsIssueLineDto } from './dto/work-order.dto';
import { WorkOrdersService } from './work-orders.service';

interface PreparedPartLine {
  itemId: string;
  sku: string;
  lotId: string | null;
  sourceLocationId: string | null;
  uomId: string;
  quantity: Prisma.Decimal;
  baseQuantity: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
  totalCost: Prisma.Decimal | null;
  notes: string | null;
}

/**
 * Parts consumption for work orders (spec §18 "Parts consumed through linked
 * inventory issues", api-outline 6.2 parts-issues).
 *
 * POST creates a MAINTENANCE_ISSUE stock transaction AND posts it through
 * the EXISTING StockPostingService inside ONE database transaction — zero
 * duplicated ledger logic; INSUFFICIENT_STOCK / LOT_EXPIRED surface exactly
 * as the posting engine raises them and roll everything back. The posted
 * transaction is linked to the WO (stock_transactions.maintenance_work_order_id)
 * and mirrored as maintenance_parts rows whose costs roll into the WO's
 * parts/total cost. A WO sitting in AWAITING_PARTS resumes to IN_PROGRESS —
 * the posted issue IS the `parts-received` event (status-transitions §5).
 */
@Injectable()
export class WorkOrderPartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workOrders: WorkOrdersService,
    private readonly posting: StockPostingService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  async list(user: AuthUser, workOrderId: string): Promise<WorkOrderPartView[]> {
    await this.workOrders.requireWo(user, workOrderId);
    const parts = await this.prisma.maintenancePart.findMany({
      where: { workOrderId },
      orderBy: { createdAt: 'asc' },
      select: WO_PART_SELECT,
    });
    const includeCost = canViewMaintenanceCost(user);
    return parts.map((part) => toWorkOrderPartView(part, includeCost));
  }

  async create(
    user: AuthUser,
    workOrderId: string,
    dto: CreatePartsIssueDto,
    idempotencyKey: string | undefined,
    ctx: AuditContext,
  ): Promise<WorkOrderPartView[]> {
    const wo = await this.workOrders.requireWo(user, workOrderId);
    this.workOrders.assertExecuteAllowed(user, wo);
    if (!canTransitionWo(wo.status, 'issue-parts')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'issue-parts'),
      );
    }
    const key = idempotencyKey?.trim() || null;
    if (key) {
      const replayed = await this.checkReplay(user, key, workOrderId);
      if (replayed) {
        return replayed;
      }
    }

    await this.requireWarehouse(dto.warehouseId, wo.branchId);
    const prepared = await this.prepareLines(dto.lines);

    const now = new Date();
    let transactionNumber = '';
    try {
      await this.prisma.$transaction(async (tx) => {
        const year = now.getUTCFullYear();
        const sequence = await this.sequences.next(
          tx,
          stockTransactionSequenceKey(year),
        );
        transactionNumber = formatStockTransactionNumber(year, sequence);
        const txn = await tx.stockTransaction.create({
          data: {
            transactionNumber,
            type: StockTransactionType.MAINTENANCE_ISSUE,
            status: StockDocumentStatus.APPROVED,
            transactionDate: now,
            branchId: wo.branchId,
            sourceWarehouseId: dto.warehouseId,
            workOrderId,
            notes: `[system] Parts issue for work order ${wo.workOrderNumber}${
              dto.notes ? `: ${dto.notes}` : ''
            }`,
            createdById: user.id,
            submittedAt: now,
            approvedById: user.id,
            approvedAt: now,
          },
          select: { id: true },
        });
        let lineNumber = 0;
        for (const line of prepared) {
          lineNumber += 1;
          await tx.stockTransactionLine.create({
            data: {
              transactionId: txn.id,
              lineNumber,
              itemId: line.itemId,
              lotId: line.lotId,
              sourceLocationId: line.sourceLocationId,
              enteredUomId: line.uomId,
              enteredQuantity: line.quantity,
              baseQuantity: line.baseQuantity,
              unitCost: line.unitCost,
              totalCost: line.totalCost,
              notes: line.notes,
            },
          });
        }

        // THE posting engine: immutable ledger + guarded balance projections.
        // INSUFFICIENT_STOCK / LOT_EXPIRED throw here and roll back all of it.
        await this.posting.postWithinTx(tx, txn.id, user.id, {
          ...(key ? { idempotencyKey: key } : {}),
        });

        for (const line of prepared) {
          await tx.maintenancePart.create({
            data: {
              workOrderId,
              itemId: line.itemId,
              lotId: line.lotId,
              uomId: line.uomId,
              quantity: line.quantity,
              baseQuantity: line.baseQuantity,
              unitCost: line.unitCost,
              totalCost: line.totalCost,
              stockTransactionId: txn.id,
              notes: line.notes,
            },
          });
        }

        // Roll the costs into the WO; a waiting WO resumes (parts-received).
        const issueTotal = prepared.reduce(
          (sum, line) => (line.totalCost ? sum.add(line.totalCost) : sum),
          new Prisma.Decimal(0),
        );
        const partsCost = (wo.partsCost ?? new Prisma.Decimal(0))
          .add(issueTotal)
          .toDecimalPlaces(2);
        await tx.maintenanceWorkOrder.update({
          where: { id: workOrderId },
          data: {
            partsCost,
            totalCost: computeWorkOrderTotalCost(
              wo.laborCost,
              partsCost,
              wo.externalCost,
            ),
            ...(wo.status === MaintenanceWorkOrderStatus.AWAITING_PARTS
              ? {
                  status: MaintenanceWorkOrderStatus.IN_PROGRESS,
                  holdReason: null,
                }
              : {}),
            version: { increment: 1 },
          },
        });
      });
    } catch (error) {
      // A concurrent request with the same Idempotency-Key won the race on
      // the stock transaction's unique key — hand back the original result.
      if (
        key &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replayed = await this.checkReplay(user, key, workOrderId);
        if (replayed) {
          return replayed;
        }
      }
      throw error;
    }

    await this.audit.log({
      action: 'maintenance_work_order.parts_issued',
      resourceType: 'maintenance_work_order',
      resourceId: workOrderId,
      branchId: wo.branchId,
      newValues: {
        transactionNumber,
        lineCount: prepared.length,
        resumedFromAwaitingParts:
          wo.status === MaintenanceWorkOrderStatus.AWAITING_PARTS,
      },
      metadata: key ? { idempotencyKey: key } : undefined,
      ...ctx,
    });
    return this.list(user, workOrderId);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async checkReplay(
    user: AuthUser,
    key: string,
    workOrderId: string,
  ): Promise<WorkOrderPartView[] | null> {
    const existing = await this.prisma.stockTransaction.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, workOrderId: true, type: true },
    });
    if (!existing) {
      return null;
    }
    if (
      existing.workOrderId !== workOrderId ||
      existing.type !== StockTransactionType.MAINTENANCE_ISSUE
    ) {
      throw new AppException(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used for a different operation.',
      );
    }
    return this.list(user, workOrderId);
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
          message: "Parts must be issued from the work order's branch.",
        },
      ]);
    }
  }

  private async prepareLines(
    lines: PartsIssueLineDto[],
  ): Promise<PreparedPartLine[]> {
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
          lastPurchaseCost: true,
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

    const prepared: PreparedPartLine[] = [];
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
      if (item.trackingMethod === TrackingMethod.SERIAL) {
        errors.push({
          field: field('itemId'),
          message: `${item.sku} is a serialized asset item — serialized units are not consumable spare parts.`,
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
      const baseQuantity = quantity.mul(factor).toDecimalPlaces(4);
      const unitCost = line.unitCost
        ? new Prisma.Decimal(line.unitCost)
        : (item.lastPurchaseCost ?? null);
      prepared.push({
        itemId: item.id,
        sku: item.sku,
        lotId: line.lotId ?? null,
        sourceLocationId: line.sourceLocationId ?? null,
        uomId: line.uomId,
        quantity,
        baseQuantity,
        unitCost,
        totalCost: unitCost ? unitCost.mul(quantity).toDecimalPlaces(2) : null,
        notes: line.notes ?? null,
      });
    });

    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
    return prepared;
  }
}
