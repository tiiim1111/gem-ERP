import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail } from '@gemerp/shared';
import {
  AssetLifecycleStatus,
  GoodsReceiptStatus,
  Prisma,
  PurchaseOrderStatus,
  StockDocumentStatus,
  StockTransactionType,
  TrackingMethod,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  assetTagSequenceKey,
  assetTagYear,
  formatAssetTag,
  generateScanToken,
} from '../assets/asset-tag.util';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import {
  formatStockTransactionNumber,
  stockTransactionSequenceKey,
} from '../inventory/inventory-numbers';
import { StockPostingService } from '../inventory/stock-posting.service';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../sequences/sequence.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import {
  deriveReceiptStatus,
} from './purchase-order-rules';
import type { GoodsReceiptDetailView } from './procurement-views';

/** Notes marker that makes a reversal replay-recognizable (see reverse()). */
function reverseMarker(key: string): string {
  return `idempotency-key ${key}`;
}

/**
 * Posting a goods receipt is THE single point where purchased goods become
 * real (spec §14 receiving): inside ONE database transaction it
 *
 *  1. claims the DRAFT → POSTED transition (idempotency-keyed),
 *  2. row-locks the PO and re-validates outstanding quantities (over-receipt
 *     is a hard 409 OVER_RECEIPT — tolerance config is a future extension),
 *  3. creates serialized Asset instances for SERIAL lines (tags + scan
 *     tokens via the same sequence/tag utilities as asset registration,
 *     acquisition cost from the PO line, linked to PO + GR line),
 *  4. posts a PURCHASE_RECEIPT stock transaction through the EXISTING
 *     StockPostingService for all non-serial lines (immutable ledger +
 *     guarded balance projections — no duplicated ledger logic), and
 *  5. rolls the PO line received quantities + PO status forward.
 *
 * Reversal reuses StockPostingService.reverse for the stock effect and then
 * rolls the PO/GR bookkeeping back; created assets must still be untouched.
 */
@Injectable()
export class GoodsReceiptPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receipts: GoodsReceiptsService,
    private readonly posting: StockPostingService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  // -------------------------------------------------------------------------
  // POST /goods-receipts/:id/post
  // -------------------------------------------------------------------------

  async post(
    user: AuthUser,
    id: string,
    idempotencyKey: string | undefined,
    ctx: AuditContext,
  ): Promise<GoodsReceiptDetailView> {
    const key = this.requireIdempotencyKey(idempotencyKey);

    const replayed = await this.checkPostReplay(user, key, id);
    if (replayed) {
      return replayed;
    }
    const receipt = await this.receipts.requireReceipt(user, id);
    if (receipt.status !== GoodsReceiptStatus.DRAFT) {
      throw AppException.invalidStateTransition(
        `Cannot post a ${receipt.status} goods receipt (only drafts post).`,
      );
    }

    let createdAssetCount = 0;
    let stockTransactionId: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        // 1. Claim the transition — the idempotency key is stored on the
        // receipt itself (unique), so a concurrent same-key post loses with
        // P2002/claim-0 and resolves as a replay below.
        const claimed = await tx.goodsReceipt.updateMany({
          where: { id, status: GoodsReceiptStatus.DRAFT },
          data: {
            status: GoodsReceiptStatus.POSTED,
            postedById: user.id,
            postedAt: now,
            idempotencyKey: key,
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The goods receipt was modified concurrently. Refetch and retry.',
          );
        }

        // 2. Serialize concurrent receipts against the same PO.
        await tx.$queryRaw`
          SELECT id FROM purchase_orders
          WHERE id = ${receipt.purchaseOrderId}::uuid
          FOR UPDATE
        `;
        const po = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: receipt.purchaseOrderId },
          select: {
            id: true,
            poNumber: true,
            status: true,
            supplierId: true,
            branch: { select: { id: true, code: true } },
            lines: {
              select: {
                id: true,
                lineNumber: true,
                quantity: true,
                receivedQuantity: true,
                canceledQuantity: true,
              },
            },
          },
        });
        if (
          po.status !== PurchaseOrderStatus.APPROVED &&
          po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
        ) {
          throw AppException.invalidStateTransition(
            `The purchase order is ${po.status} — goods can no longer be received against it.`,
          );
        }

        const lines = await tx.goodsReceiptLine.findMany({
          where: { goodsReceiptId: id },
          orderBy: { lineNumber: 'asc' },
          select: {
            id: true,
            lineNumber: true,
            purchaseOrderLineId: true,
            itemId: true,
            uomId: true,
            receivedQuantity: true,
            baseQuantity: true,
            unitCost: true,
            serialNumbers: true,
            lotId: true,
            storageLocationId: true,
            item: {
              select: {
                id: true,
                sku: true,
                trackingMethod: true,
                category: { select: { code: true } },
              },
            },
          },
        });
        if (lines.length === 0) {
          throw AppException.validation([
            { field: 'lines', message: 'The receipt has no lines to post.' },
          ]);
        }

        // 3. Authoritative over-receipt check under the PO row lock.
        this.receipts.assertWithinOutstanding(po.lines, lines);

        // 4. Serialized lines → asset instances.
        const serialLines = lines.filter(
          (line) => line.item.trackingMethod === TrackingMethod.SERIAL,
        );
        const stockLines = lines.filter(
          (line) => line.item.trackingMethod !== TrackingMethod.SERIAL,
        );
        for (const line of serialLines) {
          createdAssetCount += await this.createAssetsForLine(
            tx,
            user,
            {
              branchId: po.branch.id,
              branchCode: po.branch.code,
              warehouseId: receipt.warehouseId,
              supplierId: po.supplierId,
              purchaseOrderId: po.id,
              receiptNumber: receipt.receiptNumber,
              receiptDate: receipt.receiptDate,
            },
            line,
            now,
          );
        }

        // 5. Non-serial lines → one PURCHASE_RECEIPT stock transaction
        // posted through the shared engine (ledger + balances + guards).
        if (stockLines.length > 0) {
          const year = receipt.receiptDate.getUTCFullYear();
          const sequence = await this.sequences.next(
            tx,
            stockTransactionSequenceKey(year),
          );
          const txn = await tx.stockTransaction.create({
            data: {
              transactionNumber: formatStockTransactionNumber(year, sequence),
              type: StockTransactionType.PURCHASE_RECEIPT,
              status: StockDocumentStatus.APPROVED,
              transactionDate: receipt.receiptDate,
              branchId: po.branch.id,
              destinationWarehouseId: receipt.warehouseId,
              supplierId: po.supplierId,
              purchaseOrderId: po.id,
              goodsReceiptId: id,
              idempotencyKey: key,
              notes: `[system] Purchase receipt ${receipt.receiptNumber} against ${po.poNumber}`,
              createdById: user.id,
              submittedAt: now,
              approvedById: user.id,
              approvedAt: now,
            },
            select: { id: true },
          });
          stockTransactionId = txn.id;
          let lineNumber = 0;
          for (const line of stockLines) {
            lineNumber += 1;
            await tx.stockTransactionLine.create({
              data: {
                transactionId: txn.id,
                lineNumber,
                itemId: line.itemId,
                lotId: line.lotId,
                destinationLocationId: line.storageLocationId,
                enteredUomId: line.uomId,
                enteredQuantity: line.receivedQuantity,
                baseQuantity: line.baseQuantity,
                unitCost: line.unitCost,
                totalCost: line.unitCost
                  ? line.unitCost
                      .mul(line.receivedQuantity)
                      .toDecimalPlaces(2)
                  : null,
                notes: `Receipt line ${line.lineNumber} of ${receipt.receiptNumber}`,
              },
            });
          }
          await this.posting.postWithinTx(tx, txn.id, user.id);
        }

        // 6. Roll the PO forward: line received quantities + document status.
        const receivingByPoLine = new Map<string, Prisma.Decimal>();
        for (const line of lines) {
          receivingByPoLine.set(
            line.purchaseOrderLineId,
            (
              receivingByPoLine.get(line.purchaseOrderLineId) ??
              new Prisma.Decimal(0)
            ).add(line.receivedQuantity),
          );
        }
        for (const [poLineId, quantity] of receivingByPoLine) {
          await tx.purchaseOrderLine.update({
            where: { id: poLineId },
            data: { receivedQuantity: { increment: quantity } },
          });
        }
        const updatedLines = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId: po.id },
          select: {
            quantity: true,
            receivedQuantity: true,
            canceledQuantity: true,
          },
        });
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: deriveReceiptStatus(updatedLines),
            version: { increment: 1 },
          },
        });

        // 7. Track the latest actual purchase cost on the catalog items.
        for (const line of lines) {
          if (line.unitCost) {
            await tx.item.update({
              where: { id: line.itemId },
              data: { lastPurchaseCost: line.unitCost },
            });
          }
        }
      });
    } catch (error) {
      const resolved = await this.resolvePostFailure(user, key, id, error);
      if (resolved) {
        return resolved;
      }
      throw error;
    }

    await this.audit.log({
      action: 'goods_receipt.posted',
      resourceType: 'goods_receipt',
      resourceId: id,
      branchId: receipt.branchId,
      oldValues: { status: GoodsReceiptStatus.DRAFT },
      newValues: {
        status: GoodsReceiptStatus.POSTED,
        assetsCreated: createdAssetCount,
        stockTransactionId,
      },
      metadata: {
        idempotencyKey: key,
        receiptNumber: receipt.receiptNumber,
      },
      ...ctx,
    });
    return this.receipts.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // POST /goods-receipts/:id/reverse
  // -------------------------------------------------------------------------

  /**
   * Reverse a POSTED receipt: the linked PURCHASE_RECEIPT stock transaction
   * is reversed through the shared posting engine (offsetting ledger
   * entries, atomic, replay-safe), created assets are voided (must still be
   * untouched), and the PO outstanding quantities are restored. The stock
   * reversal and the PO/GR bookkeeping are two transactions; retrying with
   * the SAME Idempotency-Key after a mid-flight failure completes the
   * remaining half — which is exactly why the key is required here.
   */
  async reverse(
    user: AuthUser,
    id: string,
    idempotencyKey: string | undefined,
    reason: string,
    ctx: AuditContext,
  ): Promise<GoodsReceiptDetailView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const receipt = await this.receipts.requireReceipt(user, id);

    if (receipt.status === GoodsReceiptStatus.REVERSED) {
      if (receipt.notes?.includes(reverseMarker(key))) {
        return this.receipts.getById(user, id); // replay
      }
      throw AppException.invalidStateTransition(
        'This goods receipt is already reversed.',
      );
    }
    if (receipt.status !== GoodsReceiptStatus.POSTED) {
      throw AppException.invalidStateTransition(
        `Cannot reverse a ${receipt.status} goods receipt (only posted receipts).`,
      );
    }

    const po = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: receipt.purchaseOrderId },
      select: { id: true, status: true },
    });
    if (
      po.status === PurchaseOrderStatus.CLOSED ||
      po.status === PurchaseOrderStatus.CANCELED
    ) {
      throw AppException.invalidStateTransition(
        `The purchase order is ${po.status} and cannot be reopened — corrections require a new document.`,
      );
    }

    // Created assets must be untouched: still on the shelf, never assigned.
    const assets = await this.prisma.asset.findMany({
      where: { goodsReceiptLine: { goodsReceiptId: id } },
      select: {
        id: true,
        assetTag: true,
        status: true,
        archivedAt: true,
        assignments: {
          where: { status: { in: ['PENDING_ACKNOWLEDGMENT', 'ACTIVE'] } },
          select: { id: true },
        },
      },
    });
    const blocked: ApiErrorDetail[] = assets
      .filter(
        (asset) =>
          asset.archivedAt !== null ||
          asset.assignments.length > 0 ||
          (asset.status !== AssetLifecycleStatus.AVAILABLE &&
            asset.status !== AssetLifecycleStatus.DRAFT),
      )
      .map((asset) => ({
        field: asset.assetTag,
        message: `Asset ${asset.assetTag} is ${asset.status}${
          asset.assignments.length > 0 ? ' (assigned)' : ''
        } — receipts whose assets are in use cannot be reversed.`,
      }));
    if (blocked.length > 0) {
      throw new AppException(
        409,
        'INVALID_STATE_TRANSITION',
        'Cannot reverse: serialized assets created by this receipt are no longer untouched.',
        blocked,
      );
    }

    // Stock leg first (atomic + replay-safe inside the posting engine).
    const txn = await this.prisma.stockTransaction.findFirst({
      where: {
        goodsReceiptId: id,
        type: StockTransactionType.PURCHASE_RECEIPT,
      },
      select: { id: true, status: true },
    });
    if (txn) {
      if (txn.status === StockDocumentStatus.POSTED) {
        // Throws INSUFFICIENT_STOCK when the received stock is already gone.
        await this.posting.reverse(
          user,
          txn.id,
          key,
          { reason: `Goods receipt ${receipt.receiptNumber} reversed: ${reason}` },
          ctx,
        );
      } else if (txn.status !== StockDocumentStatus.REVERSED) {
        throw AppException.invalidStateTransition(
          `The linked stock transaction is ${txn.status} — the receipt cannot be reversed.`,
        );
      }
      // REVERSED already: crash-retry or a direct reversal — either way the
      // stock effect is undone; proceed with the PO/GR bookkeeping.
    }

    // Bookkeeping: claim REVERSED exactly once, then restore the PO.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.goodsReceipt.updateMany({
        where: { id, status: GoodsReceiptStatus.POSTED },
        data: {
          status: GoodsReceiptStatus.REVERSED,
          notes: this.appendNote(
            receipt.notes,
            `[reversed: ${reason} | ${reverseMarker(key)}]`,
          ),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        const current = await tx.goodsReceipt.findUnique({
          where: { id },
          select: { status: true, notes: true },
        });
        if (
          current?.status === GoodsReceiptStatus.REVERSED &&
          current.notes?.includes(reverseMarker(key))
        ) {
          return; // a concurrent replay finished the bookkeeping
        }
        throw AppException.invalidStateTransition(
          'The goods receipt was modified concurrently. Refetch and retry.',
        );
      }

      await tx.$queryRaw`
        SELECT id FROM purchase_orders
        WHERE id = ${receipt.purchaseOrderId}::uuid
        FOR UPDATE
      `;
      const lines = await tx.goodsReceiptLine.findMany({
        where: { goodsReceiptId: id },
        select: { purchaseOrderLineId: true, receivedQuantity: true },
      });
      const byPoLine = new Map<string, Prisma.Decimal>();
      for (const line of lines) {
        byPoLine.set(
          line.purchaseOrderLineId,
          (byPoLine.get(line.purchaseOrderLineId) ?? new Prisma.Decimal(0)).add(
            line.receivedQuantity,
          ),
        );
      }
      for (const [poLineId, quantity] of byPoLine) {
        const poLine = await tx.purchaseOrderLine.findUniqueOrThrow({
          where: { id: poLineId },
          select: { receivedQuantity: true },
        });
        const next = poLine.receivedQuantity.sub(quantity);
        await tx.purchaseOrderLine.update({
          where: { id: poLineId },
          data: {
            receivedQuantity: next.lt(0) ? new Prisma.Decimal(0) : next,
          },
        });
      }
      const updatedLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: receipt.purchaseOrderId },
        select: {
          quantity: true,
          receivedQuantity: true,
          canceledQuantity: true,
        },
      });
      await tx.purchaseOrder.update({
        where: { id: receipt.purchaseOrderId },
        data: {
          status: deriveReceiptStatus(updatedLines),
          version: { increment: 1 },
        },
      });

      // Void the created assets (record voided, tag number is burned).
      for (const asset of assets) {
        await tx.asset.update({
          where: { id: asset.id },
          data: { status: AssetLifecycleStatus.DRAFT, archivedAt: now },
        });
        await tx.assetStatusHistory.create({
          data: {
            assetId: asset.id,
            fromStatus: asset.status,
            toStatus: AssetLifecycleStatus.DRAFT,
            changedAt: now,
            changedById: user.id,
            notes: `goods receipt ${receipt.receiptNumber} reversed — record voided/archived`,
          },
        });
      }
    });

    await this.audit.log({
      action: 'goods_receipt.reversed',
      resourceType: 'goods_receipt',
      resourceId: id,
      branchId: receipt.branchId,
      oldValues: { status: GoodsReceiptStatus.POSTED },
      newValues: {
        status: GoodsReceiptStatus.REVERSED,
        assetsVoided: assets.length,
      },
      reason,
      metadata: { idempotencyKey: key },
      ...ctx,
    });
    return this.receipts.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Asset creation for serialized receipt lines
  // -------------------------------------------------------------------------

  /**
   * Mirrors the asset registration path (assets module) inside the receipt's
   * database transaction: tag from the (branch, category, year) counter, scan
   * token, register→activate status history, condition NEW when configured.
   * Serial uniqueness is guaranteed by @@unique([itemId, serialNumber]).
   */
  private async createAssetsForLine(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    head: {
      branchId: string;
      branchCode: string;
      warehouseId: string;
      supplierId: string;
      purchaseOrderId: string;
      receiptNumber: string;
      receiptDate: Date;
    },
    line: {
      id: string;
      lineNumber: number;
      itemId: string;
      unitCost: Prisma.Decimal | null;
      serialNumbers: string[];
      storageLocationId: string | null;
      item: {
        sku: string;
        category: { code: string } | null;
      };
    },
    now: Date,
  ): Promise<number> {
    if (!line.item.category) {
      throw AppException.validation([
        {
          field: `lines[${line.lineNumber}]`,
          message: `${line.item.sku} has no item category — required for the asset tag pattern.`,
        },
      ]);
    }
    // Received goods are condition NEW when the lookup exists; without it the
    // asset stays DRAFT (the assets module requires a condition to activate).
    const newCondition = await tx.lookupValue.findFirst({
      where: { category: 'ASSET_CONDITION', code: 'NEW', isActive: true },
      select: { id: true },
    });
    const status = newCondition
      ? AssetLifecycleStatus.AVAILABLE
      : AssetLifecycleStatus.DRAFT;

    const year = assetTagYear(now);
    const sequenceKey = assetTagSequenceKey(
      head.branchCode,
      line.item.category.code,
      year,
    );
    for (const serialNumber of line.serialNumbers) {
      const sequence = await this.sequences.next(tx, sequenceKey);
      const asset = await tx.asset.create({
        data: {
          assetTag: formatAssetTag(
            head.branchCode,
            line.item.category.code,
            year,
            sequence,
          ),
          scanToken: generateScanToken(),
          serialNumber,
          itemId: line.itemId,
          status,
          conditionId: newCondition?.id ?? null,
          branchId: head.branchId,
          warehouseId: head.warehouseId,
          storageLocationId: line.storageLocationId,
          acquisitionDate: head.receiptDate,
          acquisitionCost: line.unitCost,
          supplierId: head.supplierId,
          purchaseOrderId: head.purchaseOrderId,
          goodsReceiptLineId: line.id,
          notes: `Received via ${head.receiptNumber}`,
        },
        select: { id: true },
      });
      await tx.assetStatusHistory.create({
        data: {
          assetId: asset.id,
          fromStatus: null,
          toStatus: AssetLifecycleStatus.DRAFT,
          changedAt: now,
          changedById: user.id,
          notes: `register (goods receipt ${head.receiptNumber})`,
        },
      });
      if (status === AssetLifecycleStatus.AVAILABLE) {
        await tx.assetStatusHistory.create({
          data: {
            assetId: asset.id,
            fromStatus: AssetLifecycleStatus.DRAFT,
            toStatus: AssetLifecycleStatus.AVAILABLE,
            changedAt: now,
            changedById: user.id,
            notes: `activate (received via ${head.receiptNumber})`,
          },
        });
      }
      if (newCondition) {
        await tx.assetConditionHistory.create({
          data: {
            assetId: asset.id,
            conditionId: newCondition.id,
            recordedAt: now,
            recordedById: user.id,
            source: 'goods_receipt',
          },
        });
      }
    }
    return line.serialNumbers.length;
  }

  // -------------------------------------------------------------------------
  // Idempotency helpers
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

  /**
   * Replay resolution (api-outline 1.5): the same key replaying the same
   * post returns the ORIGINAL result; the same key pointed elsewhere is a
   * 409 IDEMPOTENCY_CONFLICT. Keys are checked on the receipt itself and on
   * the stock-transaction unique index (shared with direct stock posting).
   */
  private async checkPostReplay(
    user: AuthUser,
    key: string,
    targetId: string,
  ): Promise<GoodsReceiptDetailView | null> {
    const [byReceipt, byTxn] = await Promise.all([
      this.prisma.goodsReceipt.findUnique({
        where: { idempotencyKey: key },
        select: { id: true, status: true },
      }),
      this.prisma.stockTransaction.findUnique({
        where: { idempotencyKey: key },
        select: { goodsReceiptId: true, type: true },
      }),
    ]);
    if (!byReceipt && !byTxn) {
      return null;
    }
    const matches =
      (byReceipt &&
        byReceipt.id === targetId &&
        byReceipt.status === GoodsReceiptStatus.POSTED) ||
      (byTxn &&
        byTxn.goodsReceiptId === targetId &&
        byTxn.type === StockTransactionType.PURCHASE_RECEIPT);
    if (!matches) {
      throw new AppException(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used for a different operation.',
      );
    }
    return this.receipts.getById(user, targetId);
  }

  /**
   * Failure triage for post(): unique violations on the idempotency key are
   * replays racing us; serial-number violations become DUPLICATE_CODE;
   * claim-0 invalid-state errors are re-checked as replays.
   */
  private async resolvePostFailure(
    user: AuthUser,
    key: string,
    id: string,
    error: unknown,
  ): Promise<GoodsReceiptDetailView | null> {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = JSON.stringify(error.meta?.target ?? '');
      if (target.includes('serial')) {
        throw AppException.duplicateCode(
          'One or more serial numbers on this receipt are already registered on existing assets.',
        );
      }
      return this.checkPostReplay(user, key, id);
    }
    if (
      error instanceof AppException &&
      error.getStatus() === 409 &&
      (error.getResponse() as { error?: { code?: string } }).error?.code ===
        'INVALID_STATE_TRANSITION'
    ) {
      // The claim found the receipt no longer DRAFT — posted by a concurrent
      // request? If it carries our key, hand back the original result.
      return this.checkPostReplay(user, key, id);
    }
    return null;
  }

  private appendNote(notes: string | null, addition: string): string {
    return notes ? `${notes}\n${addition}` : addition;
  }
}
