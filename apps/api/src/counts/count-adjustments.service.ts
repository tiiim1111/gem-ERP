import { Injectable } from '@nestjs/common';
import {
  InventoryCountStatus,
  Prisma,
  StockTransactionType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { StockTransactionsService } from '../inventory/stock-transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { canCountTransition, countTransitionError } from './count-rules';
import { CountSessionsService, SessionHead } from './count-sessions.service';
import { CreateCountAdjustmentsDto } from './dto/count-session.dto';

/** Fallback ADJUSTMENT_REASON codes tried when the caller sends none. */
const DEFAULT_REASON_CODES = ['COUNT_VARIANCE', 'CYCLE_COUNT', 'PHYSICAL_COUNT'];

export interface CountAdjustmentSummary {
  id: string;
  transactionNumber: string;
  type: StockTransactionType;
  status: string;
  warehouseId: string | null;
  lineCount: number;
}

export interface CreateAdjustmentsResult {
  sessionId: string;
  countNumber: string;
  status: InventoryCountStatus;
  adjustments: CountAdjustmentSummary[];
}

/**
 * POST /count-sessions/:id/create-adjustments (api-outline 7.1).
 *
 * Turns the frozen variances of a REVIEW session into DRAFT stock-adjustment
 * transactions — one draft per warehouse and direction (increase/decrease;
 * a stock transaction document carries exactly one type) — created through
 * the EXISTING StockTransactionsService so numbering, validation, approval
 * routing, and posting behave identically to hand-written adjustments.
 * Counts NEVER touch balances: the drafts flow through the §4.1 machine.
 *
 * Idempotency-Key is REQUIRED. The key is claimed on the session
 * (adjustment_idempotency_key, unique) BEFORE drafts are created, so a
 * replay returns the original result and a crash mid-way resumes: groups
 * that already have a linked draft are skipped, then the session closes.
 */
@Injectable()
export class CountAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: CountSessionsService,
    private readonly stockTransactions: StockTransactionsService,
    private readonly audit: AuditService,
  ) {}

  async createAdjustments(
    user: AuthUser,
    id: string,
    idempotencyKey: string | undefined,
    dto: CreateCountAdjustmentsDto,
    ctx: AuditContext,
  ): Promise<CreateAdjustmentsResult> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const session = await this.sessions.requireSession(user, id);

    // Replay / conflict resolution on the session's stored key.
    if (session.adjustmentIdempotencyKey) {
      if (session.adjustmentIdempotencyKey !== key) {
        throw new AppException(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Adjustments for this session were already created with a different Idempotency-Key.',
        );
      }
      if (session.status === InventoryCountStatus.COMPLETED) {
        return this.result(session);
      }
      // Same key, still REVIEW → an earlier attempt crashed mid-way; resume.
    } else {
      if (!canCountTransition(session.status, 'create-adjustments')) {
        throw AppException.invalidStateTransition(
          countTransitionError(session.status, 'create-adjustments'),
        );
      }
      // Claim the key atomically; the unique constraint catches a replayed
      // key pointed at a DIFFERENT session.
      try {
        const claimed = await this.prisma.inventoryCountSession.updateMany({
          where: {
            id,
            status: InventoryCountStatus.REVIEW,
            adjustmentIdempotencyKey: null,
          },
          data: { adjustmentIdempotencyKey: key },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The count session was modified concurrently. Refetch and retry.',
          );
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new AppException(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This Idempotency-Key was already used for a different operation.',
          );
        }
        throw error;
      }
    }

    const reasonId = await this.resolveReason(dto);

    // Variance groups: quantity lines only (serialized assets never move
    // through quantity adjustments), grouped per warehouse and direction.
    const lines = await this.prisma.inventoryCountLine.findMany({
      where: {
        countSessionId: id,
        assetId: null,
        itemId: { not: null },
        varianceQuantity: { not: 0 },
      },
      select: {
        itemId: true,
        lotId: true,
        warehouseId: true,
        storageLocationId: true,
        uomId: true,
        varianceQuantity: true,
      },
    });

    const groups = new Map<
      string,
      {
        warehouseId: string;
        type: StockTransactionType;
        lines: typeof lines;
      }
    >();
    for (const line of lines) {
      const variance = line.varianceQuantity as Prisma.Decimal;
      if (!line.warehouseId || !line.itemId || !line.uomId) {
        continue;
      }
      const type = variance.gt(0)
        ? StockTransactionType.ADJUSTMENT_INCREASE
        : StockTransactionType.ADJUSTMENT_DECREASE;
      const groupKey = `${line.warehouseId}|${type}`;
      const group = groups.get(groupKey) ?? {
        warehouseId: line.warehouseId,
        type,
        lines: [] as typeof lines,
      };
      group.lines.push(line);
      groups.set(groupKey, group);
    }

    // Resume support: skip groups that already produced a linked draft.
    const existing = await this.prisma.stockTransaction.findMany({
      where: { countSessionId: id },
      select: {
        type: true,
        sourceWarehouseId: true,
        destinationWarehouseId: true,
      },
    });
    const existingKeys = new Set(
      existing.map(
        (txn) =>
          `${txn.sourceWarehouseId ?? txn.destinationWarehouseId}|${txn.type}`,
      ),
    );

    for (const [groupKey, group] of groups) {
      if (existingKeys.has(groupKey)) {
        continue;
      }
      const created = await this.stockTransactions.create(
        user,
        {
          type: group.type,
          branchId: session.branchId,
          warehouseId: group.warehouseId,
          reasonId,
          notes: `[count:${session.countNumber}] Variance adjustment generated from the physical count${
            dto.notes ? ` — ${dto.notes}` : ''
          }`,
          lines: group.lines.map((line) => ({
            itemId: line.itemId as string,
            uomId: line.uomId as string,
            quantity: (line.varianceQuantity as Prisma.Decimal)
              .abs()
              .toString(),
            ...(line.lotId ? { lotId: line.lotId } : {}),
            ...(line.storageLocationId
              ? { locationId: line.storageLocationId }
              : {}),
          })),
        },
        ctx,
      );
      await this.prisma.stockTransaction.update({
        where: { id: created.id },
        data: { countSessionId: id },
      });
    }

    // Close the session (also the zero-variance close path).
    const closed = await this.prisma.inventoryCountSession.updateMany({
      where: { id, status: InventoryCountStatus.REVIEW },
      data: {
        status: InventoryCountStatus.COMPLETED,
        adjustmentsCreatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (closed.count === 0) {
      throw AppException.invalidStateTransition(
        'The count session was modified concurrently. Refetch and retry.',
      );
    }

    const result = await this.result(session);
    await this.audit.log({
      action: 'count_session.adjustments_created',
      resourceType: 'count_session',
      resourceId: id,
      branchId: session.branchId,
      newValues: {
        countNumber: session.countNumber,
        adjustments: result.adjustments.map((adjustment) => ({
          transactionNumber: adjustment.transactionNumber,
          type: adjustment.type,
          warehouseId: adjustment.warehouseId,
        })),
      },
      metadata: { idempotencyKey: key },
      ...ctx,
    });
    return result;
  }

  private async result(session: SessionHead): Promise<CreateAdjustmentsResult> {
    const [row, drafts] = await Promise.all([
      this.prisma.inventoryCountSession.findUnique({
        where: { id: session.id },
        select: { status: true },
      }),
      this.prisma.stockTransaction.findMany({
        where: { countSessionId: session.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          transactionNumber: true,
          type: true,
          status: true,
          sourceWarehouseId: true,
          destinationWarehouseId: true,
          _count: { select: { lines: true } },
        },
      }),
    ]);
    return {
      sessionId: session.id,
      countNumber: session.countNumber,
      status: row?.status ?? InventoryCountStatus.COMPLETED,
      adjustments: drafts.map((draft) => ({
        id: draft.id,
        transactionNumber: draft.transactionNumber,
        type: draft.type,
        status: draft.status,
        warehouseId: draft.sourceWarehouseId ?? draft.destinationWarehouseId,
        lineCount: draft._count.lines,
      })),
    };
  }

  private async resolveReason(
    dto: CreateCountAdjustmentsDto,
  ): Promise<string> {
    if (dto.reasonId) {
      const reason = await this.prisma.lookupValue.findFirst({
        where: { id: dto.reasonId, category: 'ADJUSTMENT_REASON', isActive: true },
        select: { id: true },
      });
      if (!reason) {
        throw AppException.validation([
          {
            field: 'reasonId',
            message: 'reasonId must be an active ADJUSTMENT_REASON lookup value.',
          },
        ]);
      }
      return reason.id;
    }
    const codes = dto.reasonCode
      ? [dto.reasonCode.toUpperCase()]
      : DEFAULT_REASON_CODES;
    const reason = await this.prisma.lookupValue.findFirst({
      where: {
        category: 'ADJUSTMENT_REASON',
        code: { in: codes },
        isActive: true,
      },
      select: { id: true },
    });
    if (!reason) {
      throw AppException.validation([
        {
          field: 'reasonCode',
          message: `No active ADJUSTMENT_REASON lookup matches ${codes.join(', ')} — pass reasonId or seed the reason.`,
        },
      ]);
    }
    return reason.id;
  }

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
}
