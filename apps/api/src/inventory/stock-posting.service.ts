import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import {
  Prisma,
  StockDocumentStatus,
  StockTransactionType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  formatStockTransactionNumber,
  stockTransactionSequenceKey,
} from './inventory-numbers';
import {
  canTransition,
  directionOf,
  transitionError,
} from './stock-transaction-rules';
import {
  canViewInventoryCost,
  STOCK_TXN_DETAIL_SELECT,
  StockTransactionDetailView,
  toStockTransactionDetailView,
} from './stock-transaction-views';
import {
  PostStockTransactionDto,
  ReverseStockTransactionDto,
} from './dto/stock-transaction-actions.dto';

/** One stock-balance projection bucket (spec §3: balances are projections). */
export interface BalanceBucket {
  itemId: string;
  branchId: string;
  warehouseId: string;
  storageLocationId: string | null;
  lotId: string | null;
}

interface PlannedEntry {
  lineId: string;
  lineNumber: number;
  itemSku: string;
  bucket: BalanceBucket;
  /** Signed base-quantity delta. */
  delta: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
}

interface InsufficientDetail {
  lineNumber: number;
  itemSku: string;
  requested: string;
  available: string;
  bucket: BalanceBucket;
}

/**
 * THE POSTING ENGINE (spec §3 invariants).
 *
 * Every stock movement flows through here inside ONE database transaction:
 * status-transition claim → immutable ledger entries → atomic balance
 * projection updates. Concurrency safety comes from two layers:
 *
 * 1. `pg_advisory_xact_lock` per balance bucket serializes concurrent posts
 *    touching the same (item, warehouse, location, lot) — locks are acquired
 *    in a deterministic (sorted) order to make deadlocks impossible.
 * 2. Decrements additionally run as conditional UPDATEs guarded by
 *    `on_hand_qty - reserved_qty >= needed`, so stock can NEVER go negative
 *    even if a future code path skips the advisory lock.
 *
 * Ledger entries are append-only: nothing in this service (or anywhere else)
 * updates or deletes a stock_ledger_entries row. Corrections are reversals.
 */
@Injectable()
export class StockPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  // -------------------------------------------------------------------------
  // Balance-projection primitives (shared with TransfersService)
  // -------------------------------------------------------------------------

  private lockKey(bucket: BalanceBucket): string {
    return `sb|${bucket.itemId}|${bucket.warehouseId}|${
      bucket.storageLocationId ?? '-'
    }|${bucket.lotId ?? '-'}`;
  }

  private async acquireBucketLock(
    tx: Prisma.TransactionClient,
    bucket: BalanceBucket,
  ): Promise<void> {
    // ::text cast — pg_advisory_xact_lock returns void, which $queryRaw
    // cannot deserialize.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${this.lockKey(
      bucket,
    )}::text, 0))::text`;
  }

  private async findBucketRow(
    tx: Prisma.TransactionClient,
    bucket: BalanceBucket,
  ): Promise<{ id: string; onHand: Prisma.Decimal; reserved: Prisma.Decimal; inTransit: Prisma.Decimal } | null> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; on_hand: string; reserved: string; in_transit: string }>
    >`
      SELECT id, on_hand_qty::text AS on_hand, reserved_qty::text AS reserved,
             in_transit_qty::text AS in_transit
      FROM stock_balances
      WHERE item_id = ${bucket.itemId}::uuid
        AND warehouse_id = ${bucket.warehouseId}::uuid
        AND storage_location_id IS NOT DISTINCT FROM ${bucket.storageLocationId}::uuid
        AND lot_id IS NOT DISTINCT FROM ${bucket.lotId}::uuid
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      onHand: new Prisma.Decimal(row.on_hand),
      reserved: new Prisma.Decimal(row.reserved),
      inTransit: new Prisma.Decimal(row.in_transit),
    };
  }

  /**
   * Apply a signed on-hand delta to one bucket. Returns the shortfall detail
   * instead of throwing so the caller can aggregate per-line errors into one
   * INSUFFICIENT_STOCK envelope. Never lets on-hand minus reserved go below
   * zero (conditional UPDATE re-checks even under the advisory lock).
   */
  async applyOnHandDelta(
    tx: Prisma.TransactionClient,
    bucket: BalanceBucket,
    delta: Prisma.Decimal,
  ): Promise<{ ok: true } | { ok: false; available: Prisma.Decimal }> {
    await this.acquireBucketLock(tx, bucket);
    const row = await this.findBucketRow(tx, bucket);

    if (delta.gte(0)) {
      if (row) {
        await tx.stockBalance.update({
          where: { id: row.id },
          data: { onHandQty: { increment: delta } },
        });
      } else {
        await tx.stockBalance.create({
          data: {
            itemId: bucket.itemId,
            branchId: bucket.branchId,
            warehouseId: bucket.warehouseId,
            storageLocationId: bucket.storageLocationId,
            lotId: bucket.lotId,
            onHandQty: delta,
          },
        });
      }
      return { ok: true };
    }

    const needed = delta.neg();
    if (!row) {
      return { ok: false, available: new Prisma.Decimal(0) };
    }
    const available = row.onHand.sub(row.reserved);
    const affected = await tx.$executeRaw`
      UPDATE stock_balances
      SET on_hand_qty = on_hand_qty - ${needed.toString()}::numeric,
          updated_at = NOW()
      WHERE id = ${row.id}::uuid
        AND on_hand_qty - reserved_qty >= ${needed.toString()}::numeric
    `;
    if (affected !== 1) {
      return { ok: false, available };
    }
    return { ok: true };
  }

  /**
   * Apply a signed in-transit delta (inter-branch transfers, spec §16).
   * Decrements are guarded so the in-transit bucket can never go negative.
   */
  async applyInTransitDelta(
    tx: Prisma.TransactionClient,
    bucket: BalanceBucket,
    delta: Prisma.Decimal,
  ): Promise<{ ok: true } | { ok: false; inTransit: Prisma.Decimal }> {
    await this.acquireBucketLock(tx, bucket);
    const row = await this.findBucketRow(tx, bucket);

    if (delta.gte(0)) {
      if (row) {
        await tx.stockBalance.update({
          where: { id: row.id },
          data: { inTransitQty: { increment: delta } },
        });
      } else {
        await tx.stockBalance.create({
          data: {
            itemId: bucket.itemId,
            branchId: bucket.branchId,
            warehouseId: bucket.warehouseId,
            storageLocationId: bucket.storageLocationId,
            lotId: bucket.lotId,
            inTransitQty: delta,
          },
        });
      }
      return { ok: true };
    }

    const needed = delta.neg();
    if (!row) {
      return { ok: false, inTransit: new Prisma.Decimal(0) };
    }
    const affected = await tx.$executeRaw`
      UPDATE stock_balances
      SET in_transit_qty = in_transit_qty - ${needed.toString()}::numeric,
          updated_at = NOW()
      WHERE id = ${row.id}::uuid
        AND in_transit_qty >= ${needed.toString()}::numeric
    `;
    if (affected !== 1) {
      return { ok: false, inTransit: row.inTransit };
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Core posting (used by post(), reverse() and TransfersService legs)
  // -------------------------------------------------------------------------

  /**
   * Post an APPROVED transaction inside the caller's database transaction:
   * claims the status transition atomically, validates lot expiry, writes the
   * immutable ledger entries, and applies balance deltas with negative-stock
   * guards. Throws INVALID_STATE_TRANSITION / LOT_EXPIRED / INSUFFICIENT_STOCK
   * (rolling the whole transaction back).
   */
  async postWithinTx(
    tx: Prisma.TransactionClient,
    txnId: string,
    actorUserId: string,
    opts: { idempotencyKey?: string; allowExpiredLots?: boolean } = {},
  ): Promise<void> {
    const postedAt = new Date();
    const claimed = await tx.stockTransaction.updateMany({
      where: { id: txnId, status: StockDocumentStatus.APPROVED },
      data: {
        status: StockDocumentStatus.POSTED,
        postedById: actorUserId,
        postedAt,
        version: { increment: 1 },
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      },
    });
    if (claimed.count === 0) {
      const current = await tx.stockTransaction.findUnique({
        where: { id: txnId },
        select: { status: true },
      });
      throw AppException.invalidStateTransition(
        current
          ? transitionError(current.status, 'post')
          : 'Stock transaction not found.',
      );
    }

    const txn = await tx.stockTransaction.findUniqueOrThrow({
      where: { id: txnId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            item: { select: { id: true, sku: true } },
            lot: { select: { id: true, lotNumber: true, expiryDate: true } },
          },
        },
      },
    });

    const direction = directionOf(txn.type);
    if (!direction) {
      throw AppException.invalidStateTransition(
        'REVERSAL transactions are posted by the reverse endpoint, never directly.',
      );
    }

    // Lot expiry (spec §13): outbound consumption of an expired lot is
    // refused unless the caller explicitly overrides with permission.
    if (direction !== 'IN' && !opts.allowExpiredLots) {
      const today = this.todayUtc();
      const expired: ApiErrorDetail[] = txn.lines
        .filter((line) => line.lot?.expiryDate && line.lot.expiryDate < today)
        .map((line) => ({
          field: `lines[${line.lineNumber}]`,
          message: `Lot ${line.lot?.lotNumber} of ${line.item.sku} expired on ${line.lot?.expiryDate
            ?.toISOString()
            .slice(0, 10)}.`,
        }));
      if (expired.length > 0) {
        throw new AppException(
          409,
          'LOT_EXPIRED',
          'One or more lots are expired. Pick an unexpired lot (FEFO: GET /lots?fefo=true) or override with allowExpiredLots.',
          expired,
        );
      }
    }

    const planned: PlannedEntry[] = [];
    for (const line of txn.lines) {
      const unitCost =
        line.totalCost && line.baseQuantity.gt(0)
          ? line.totalCost.div(line.baseQuantity).toDecimalPlaces(2)
          : null;
      const base = {
        lineId: line.id,
        lineNumber: line.lineNumber,
        itemSku: line.item.sku,
        unitCost,
      };
      if (direction === 'IN' || direction === 'MOVE') {
        const warehouseId =
          direction === 'IN'
            ? txn.destinationWarehouseId
            : (txn.destinationWarehouseId ?? txn.sourceWarehouseId);
        if (!warehouseId) {
          throw AppException.validation([
            { field: 'destinationWarehouseId', message: 'Missing destination warehouse.' },
          ]);
        }
        planned.push({
          ...base,
          bucket: {
            itemId: line.itemId,
            branchId: txn.branchId,
            warehouseId,
            storageLocationId: line.destinationLocationId,
            lotId: line.lotId,
          },
          delta: line.baseQuantity,
        });
      }
      if (direction === 'OUT' || direction === 'MOVE') {
        if (!txn.sourceWarehouseId) {
          throw AppException.validation([
            { field: 'warehouseId', message: 'Missing source warehouse.' },
          ]);
        }
        planned.push({
          ...base,
          bucket: {
            itemId: line.itemId,
            branchId: txn.branchId,
            warehouseId: txn.sourceWarehouseId,
            storageLocationId: line.sourceLocationId,
            lotId: line.lotId,
          },
          delta: line.baseQuantity.neg(),
        });
      }
    }

    // Deterministic lock order across concurrent posts → no deadlocks.
    const ordered = [...planned].sort((a, b) =>
      this.lockKey(a.bucket).localeCompare(this.lockKey(b.bucket)),
    );

    const failures: InsufficientDetail[] = [];
    for (const entry of ordered) {
      const result = await this.applyOnHandDelta(tx, entry.bucket, entry.delta);
      if (!result.ok) {
        failures.push({
          lineNumber: entry.lineNumber,
          itemSku: entry.itemSku,
          requested: entry.delta.neg().toString(),
          available: result.available.toString(),
          bucket: entry.bucket,
        });
      }
    }
    if (failures.length > 0) {
      throw new AppException(
        409,
        'INSUFFICIENT_STOCK',
        'Posting would drive stock below zero.',
        failures.map((failure) => ({
          field: `lines[${failure.lineNumber}]`,
          message: `${failure.itemSku}: requested ${failure.requested} (base units), available ${failure.available}${
            failure.bucket.lotId ? ' in the selected lot' : ''
          }.`,
        })),
      );
    }

    await tx.stockLedgerEntry.createMany({
      data: planned.map((entry) => ({
        transactionId: txn.id,
        transactionLineId: entry.lineId,
        itemId: entry.bucket.itemId,
        lotId: entry.bucket.lotId,
        branchId: entry.bucket.branchId,
        warehouseId: entry.bucket.warehouseId,
        storageLocationId: entry.bucket.storageLocationId,
        quantityDelta: entry.delta,
        unitCost: entry.unitCost,
        postedAt,
      })),
    });
  }

  // -------------------------------------------------------------------------
  // POST /stock-transactions/:id/post
  // -------------------------------------------------------------------------

  async post(
    user: AuthUser,
    id: string,
    idempotencyKey: string | undefined,
    dto: PostStockTransactionDto,
    ctx: AuditContext,
  ): Promise<StockTransactionDetailView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    if (
      dto.allowExpiredLots &&
      !user.isSuperAdmin &&
      !user.permissions.includes(PERMISSIONS.inventory.adjust)
    ) {
      throw AppException.forbidden(
        'Overriding expired lots requires inventory.adjust.',
      );
    }

    const replayed = await this.checkReplay(user, key, id, 'post');
    if (replayed) {
      return replayed;
    }

    const txn = await this.prisma.stockTransaction.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        branchId: true,
        transferId: true,
        transactionNumber: true,
        type: true,
      },
    });
    if (!txn || !this.branchScope.canAccess(user, txn.branchId)) {
      throw AppException.notFound('Stock transaction not found.');
    }
    if (txn.transferId) {
      throw AppException.invalidStateTransition(
        'Transfer-leg transactions are posted by the transfer dispatch/receive flow.',
      );
    }
    if (!canTransition(txn.status, 'post')) {
      throw AppException.invalidStateTransition(
        transitionError(txn.status, 'post'),
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.postWithinTx(tx, id, user.id, {
          idempotencyKey: key,
          allowExpiredLots: dto.allowExpiredLots,
        });
      });
    } catch (error) {
      // Unique violation on idempotency_key: a concurrent request with the
      // same key won the race — resolve it as a replay.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replayedAfterRace = await this.checkReplay(user, key, id, 'post');
        if (replayedAfterRace) {
          return replayedAfterRace;
        }
      }
      throw error;
    }

    await this.audit.log({
      action: 'stock_transaction.posted',
      resourceType: 'stock_transaction',
      resourceId: id,
      branchId: txn.branchId,
      oldValues: { status: txn.status },
      newValues: { status: StockDocumentStatus.POSTED },
      metadata: { idempotencyKey: key, transactionNumber: txn.transactionNumber },
      ...ctx,
    });
    return this.detail(user, id);
  }

  // -------------------------------------------------------------------------
  // POST /stock-transactions/:id/reverse
  // -------------------------------------------------------------------------

  /**
   * Creates a linked REVERSAL transaction whose ledger entries are the exact
   * negation of the original's, posts it through the same guarded balance
   * application, and marks the original REVERSED. The original is never
   * edited or deleted (spec §3).
   */
  async reverse(
    user: AuthUser,
    id: string,
    idempotencyKey: string | undefined,
    dto: ReverseStockTransactionDto,
    ctx: AuditContext,
  ): Promise<StockTransactionDetailView> {
    const key = this.requireIdempotencyKey(idempotencyKey);

    const replayed = await this.checkReplay(user, key, id, 'reverse');
    if (replayed) {
      return replayed;
    }

    const original = await this.prisma.stockTransaction.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        ledgerEntries: true,
      },
    });
    if (!original || !this.branchScope.canAccess(user, original.branchId)) {
      throw AppException.notFound('Stock transaction not found.');
    }
    if (original.type === StockTransactionType.REVERSAL) {
      throw AppException.invalidStateTransition(
        'A reversal cannot be reversed. Correct with a new transaction instead.',
      );
    }
    if (original.transferId) {
      throw AppException.invalidStateTransition(
        'Transfer-leg transactions are corrected through the transfer flow, not direct reversal.',
      );
    }
    if (!canTransition(original.status, 'reverse')) {
      throw AppException.invalidStateTransition(
        transitionError(original.status, 'reverse'),
      );
    }

    let reversalId = '';
    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const claimed = await tx.stockTransaction.updateMany({
          where: { id, status: StockDocumentStatus.POSTED },
          data: {
            status: StockDocumentStatus.REVERSED,
            reversedById: user.id,
            reversedAt: now,
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The transaction was modified concurrently. Refetch and retry.',
          );
        }

        const year = now.getUTCFullYear();
        const sequence = await this.sequences.next(
          tx,
          stockTransactionSequenceKey(year),
        );
        const reversal = await tx.stockTransaction.create({
          data: {
            transactionNumber: formatStockTransactionNumber(year, sequence),
            type: StockTransactionType.REVERSAL,
            status: StockDocumentStatus.POSTED,
            transactionDate: now,
            branchId: original.branchId,
            sourceBranchId: original.sourceBranchId,
            destinationBranchId: original.destinationBranchId,
            sourceWarehouseId: original.sourceWarehouseId,
            destinationWarehouseId: original.destinationWarehouseId,
            employeeId: original.employeeId,
            departmentId: original.departmentId,
            supplierId: original.supplierId,
            projectRef: original.projectRef,
            reasonId: dto.reasonId ?? null,
            notes: `Reversal of ${original.transactionNumber}: ${dto.reason}`,
            reversalOfId: original.id,
            idempotencyKey: key,
            createdById: user.id,
            submittedAt: now,
            // No approval workflow engine yet (Phase 6) — auto-approved.
            approvedById: user.id,
            approvedAt: now,
            postedById: user.id,
            postedAt: now,
          },
          select: { id: true, transactionNumber: true },
        });
        reversalId = reversal.id;

        const lineIdByNumber = new Map<number, string>();
        for (const line of original.lines) {
          const created = await tx.stockTransactionLine.create({
            data: {
              transactionId: reversal.id,
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              lotId: line.lotId,
              sourceLocationId: line.sourceLocationId,
              destinationLocationId: line.destinationLocationId,
              enteredUomId: line.enteredUomId,
              enteredQuantity: line.enteredQuantity,
              baseQuantity: line.baseQuantity,
              unitCost: line.unitCost,
              totalCost: line.totalCost,
              notes: `Reverses line ${line.lineNumber} of ${original.transactionNumber}`,
            },
            select: { id: true, lineNumber: true },
          });
          lineIdByNumber.set(created.lineNumber, created.id);
        }
        const originalLineNumberById = new Map(
          original.lines.map((line) => [line.id, line.lineNumber]),
        );

        // Negate the original's ledger entries (the authoritative record of
        // what the posting actually did) and re-apply with the same guards.
        const negated = original.ledgerEntries.map((entry) => ({
          entry,
          delta: entry.quantityDelta.neg(),
          bucket: {
            itemId: entry.itemId,
            branchId: entry.branchId,
            warehouseId: entry.warehouseId,
            storageLocationId: entry.storageLocationId,
            lotId: entry.lotId,
          } satisfies BalanceBucket,
        }));
        const ordered = [...negated].sort((a, b) =>
          this.lockKey(a.bucket).localeCompare(this.lockKey(b.bucket)),
        );
        const failures: ApiErrorDetail[] = [];
        for (const { entry, delta, bucket } of ordered) {
          const result = await this.applyOnHandDelta(tx, bucket, delta);
          if (!result.ok) {
            const lineNumber = entry.transactionLineId
              ? (originalLineNumberById.get(entry.transactionLineId) ?? 0)
              : 0;
            failures.push({
              field: `lines[${lineNumber}]`,
              message: `Reversal needs ${delta.neg().toString()} base units still on hand; available ${result.available.toString()}.`,
            });
          }
        }
        if (failures.length > 0) {
          throw new AppException(
            409,
            'INSUFFICIENT_STOCK',
            'Cannot reverse: the stock this transaction brought in is no longer on hand.',
            failures,
          );
        }

        await tx.stockLedgerEntry.createMany({
          data: negated.map(({ entry, delta }) => ({
            transactionId: reversal.id,
            transactionLineId: entry.transactionLineId
              ? (lineIdByNumber.get(
                  originalLineNumberById.get(entry.transactionLineId) ?? -1,
                ) ?? null)
              : null,
            itemId: entry.itemId,
            lotId: entry.lotId,
            branchId: entry.branchId,
            warehouseId: entry.warehouseId,
            storageLocationId: entry.storageLocationId,
            quantityDelta: delta,
            unitCost: entry.unitCost,
            postedAt: now,
          })),
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replayedAfterRace = await this.checkReplay(
          user,
          key,
          id,
          'reverse',
        );
        if (replayedAfterRace) {
          return replayedAfterRace;
        }
      }
      throw error;
    }

    await this.audit.log({
      action: 'stock_transaction.reversed',
      resourceType: 'stock_transaction',
      resourceId: id,
      branchId: original.branchId,
      oldValues: { status: original.status },
      newValues: { status: StockDocumentStatus.REVERSED, reversalId },
      reason: dto.reason,
      metadata: { idempotencyKey: key },
      ...ctx,
    });
    return this.detail(user, reversalId);
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

  /**
   * Idempotency replay resolution (api-outline 1.5): the same key replaying
   * the same operation returns the ORIGINAL result; the same key pointed at a
   * different operation is a 409 IDEMPOTENCY_CONFLICT.
   */
  private async checkReplay(
    user: AuthUser,
    key: string,
    targetId: string,
    action: 'post' | 'reverse',
  ): Promise<StockTransactionDetailView | null> {
    const existing = await this.prisma.stockTransaction.findUnique({
      where: { idempotencyKey: key },
      select: {
        id: true,
        status: true,
        type: true,
        reversalOfId: true,
        branchId: true,
      },
    });
    if (!existing) {
      return null;
    }
    const matches =
      action === 'post'
        ? existing.id === targetId &&
          existing.status === StockDocumentStatus.POSTED
        : existing.type === StockTransactionType.REVERSAL &&
          existing.reversalOfId === targetId;
    if (!matches) {
      throw new AppException(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used for a different operation.',
      );
    }
    if (!this.branchScope.canAccess(user, existing.branchId)) {
      throw AppException.notFound('Stock transaction not found.');
    }
    return this.detail(user, existing.id);
  }

  private async detail(
    user: AuthUser,
    id: string,
  ): Promise<StockTransactionDetailView> {
    const row = await this.prisma.stockTransaction.findUnique({
      where: { id },
      select: STOCK_TXN_DETAIL_SELECT,
    });
    if (!row) {
      throw AppException.notFound('Stock transaction not found.');
    }
    return toStockTransactionDetailView(row, canViewInventoryCost(user));
  }

  private todayUtc(): Date {
    return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
}
