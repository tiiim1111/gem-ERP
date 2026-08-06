import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Paginated } from '@gemerp/shared';
import {
  Prisma,
  StockDocumentStatus,
  StockTransactionType,
  TrackingMethod,
  TransferStatus,
  TransferType,
} from '@prisma/client';
import { ApprovalEngineService } from '../approvals/approval-engine.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import {
  formatStockTransactionNumber,
  formatTransferNumber,
  formatTransferReceiptNumber,
  stockTransactionSequenceKey,
  transferReceiptSequenceKey,
  transferSequenceKey,
} from '../inventory/inventory-numbers';
import { StockPostingService } from '../inventory/stock-posting.service';
import { conversionFactor } from '../items/uom-conversion.util';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  canTransferTransition,
  transferTransitionError,
} from './transfer-rules';
import { CreateTransferDto, TransferLineDto } from './dto/create-transfer.dto';
import { QueryTransfersDto } from './dto/query-transfers.dto';
import {
  ApproveTransferDto,
  CancelTransferDto,
  ReceiveTransferDto,
  RejectTransferDto,
} from './dto/transfer-actions.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';

const SORTABLE = {
  transferNumber: 'transferNumber',
  transferDate: 'transferDate',
  status: 'status',
  createdAt: 'createdAt',
};

const ACTOR_SELECT = { select: { id: true, displayName: true, email: true } };

const TRANSFER_LIST_SELECT = {
  id: true,
  transferNumber: true,
  type: true,
  status: true,
  transferDate: true,
  sourceBranch: { select: { id: true, code: true, name: true } },
  sourceWarehouse: { select: { id: true, code: true, name: true } },
  sourceLocation: { select: { id: true, code: true, name: true } },
  destinationBranch: { select: { id: true, code: true, name: true } },
  destinationWarehouse: { select: { id: true, code: true, name: true } },
  destinationLocation: { select: { id: true, code: true, name: true } },
  reason: { select: { id: true, category: true, code: true, name: true } },
  notes: true,
  version: true,
  createdBy: ACTOR_SELECT,
  submittedAt: true,
  approvedBy: ACTOR_SELECT,
  approvedAt: true,
  dispatchedBy: ACTOR_SELECT,
  dispatchedAt: true,
  completedAt: true,
  canceledBy: ACTOR_SELECT,
  canceledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TransferSelect;

const TRANSFER_DETAIL_SELECT = {
  ...TRANSFER_LIST_SELECT,
  lines: {
    orderBy: { lineNumber: 'asc' },
    select: {
      id: true,
      lineNumber: true,
      item: { select: { id: true, sku: true, name: true } },
      lot: { select: { id: true, lotNumber: true, expiryDate: true } },
      uom: { select: { id: true, code: true, name: true } },
      quantity: true,
      baseQuantity: true,
      dispatchedQuantity: true,
      receivedQuantity: true,
      damagedQuantity: true,
      shortQuantity: true,
      rejectedQuantity: true,
      notes: true,
    },
  },
  receipts: {
    orderBy: { receivedAt: 'asc' },
    select: {
      id: true,
      receiptNumber: true,
      receivedBy: ACTOR_SELECT,
      receivedAt: true,
      notes: true,
      lines: {
        select: {
          id: true,
          transferLineId: true,
          receivedQuantity: true,
          damagedQuantity: true,
          shortQuantity: true,
          rejectedQuantity: true,
          condition: { select: { id: true, code: true, name: true } },
          notes: true,
        },
      },
    },
  },
  stockTransactions: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, transactionNumber: true, type: true, status: true },
  },
} satisfies Prisma.TransferSelect;

type TransferListRow = Prisma.TransferGetPayload<{
  select: typeof TRANSFER_LIST_SELECT;
}>;
type TransferDetailRow = Prisma.TransferGetPayload<{
  select: typeof TRANSFER_DETAIL_SELECT;
}>;

export interface TransferView extends Omit<TransferListRow, 'transferDate'> {
  transferDate: string;
}

export interface TransferDetailView extends TransferView {
  lines: Array<
    Omit<
      TransferDetailRow['lines'][number],
      | 'quantity'
      | 'baseQuantity'
      | 'dispatchedQuantity'
      | 'receivedQuantity'
      | 'damagedQuantity'
      | 'shortQuantity'
      | 'rejectedQuantity'
    > & {
      quantity: string | null;
      baseQuantity: string | null;
      dispatchedQuantity: string;
      receivedQuantity: string;
      damagedQuantity: string;
      shortQuantity: string;
      rejectedQuantity: string;
    }
  >;
  receipts: Array<
    Omit<TransferDetailRow['receipts'][number], 'lines'> & {
      lines: Array<
        Omit<
          TransferDetailRow['receipts'][number]['lines'][number],
          | 'receivedQuantity'
          | 'damagedQuantity'
          | 'shortQuantity'
          | 'rejectedQuantity'
        > & {
          receivedQuantity: string;
          damagedQuantity: string;
          shortQuantity: string;
          rejectedQuantity: string;
        }
      >;
    }
  >;
  stockTransactions: TransferDetailRow['stockTransactions'];
}

interface PreparedTransferLine {
  itemId: string;
  lotId: string | null;
  uomId: string;
  quantity: Prisma.Decimal;
  baseQuantity: Prisma.Decimal;
  notes: string | null;
}

/**
 * Transfer documents (spec §16, api-outline 4.5): bin-to-bin and
 * warehouse-to-warehouse moves inside a branch, and the controlled
 * inter-branch flow draft → submit → approve → dispatch (source ledger out,
 * stock into the destination's in-transit bucket) → receive & inspect
 * (received/damaged/short per line, destination ledger in) → RECEIVED.
 * Every stock effect flows through the guarded posting engine.
 */
@Injectable()
export class TransfersService {
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
    query: QueryTransfersDto,
  ): Promise<Paginated<TransferView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });
    if (query.sourceBranchId) {
      this.branchScope.assertBranchAccess(user, query.sourceBranchId);
    }
    if (query.destinationBranchId) {
      this.branchScope.assertBranchAccess(user, query.destinationBranchId);
    }

    // Cross-branch visibility: source OR destination access (outline 1.7).
    const scope = this.branchScope.branchFilter(user);
    const where: Prisma.TransferWhereInput = {
      ...(scope
        ? {
            OR: [
              { sourceBranchId: { in: scope.in } },
              { destinationBranchId: { in: scope.in } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { type: query.kind } : {}),
      ...(query.sourceBranchId ? { sourceBranchId: query.sourceBranchId } : {}),
      ...(query.destinationBranchId
        ? { destinationBranchId: query.destinationBranchId }
        : {}),
      ...(query.number
        ? { transferNumber: { contains: query.number, mode: 'insensitive' } }
        : {}),
      ...(query.from || query.to
        ? {
            transferDate: {
              ...(query.from ? { gte: this.toDate(query.from) } : {}),
              ...(query.to ? { lte: this.toDate(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.transfer.findMany({
        where,
        orderBy,
        skip,
        take,
        select: TRANSFER_LIST_SELECT,
      }),
      this.prisma.transfer.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.toView(row)),
      page,
      pageSize,
      total,
    );
  }

  async getById(user: AuthUser, id: string): Promise<TransferDetailView> {
    const row = await this.prisma.transfer.findUnique({
      where: { id },
      select: TRANSFER_DETAIL_SELECT,
    });
    if (
      !row ||
      (!this.branchScope.canAccess(user, row.sourceBranch.id) &&
        !this.branchScope.canAccess(user, row.destinationBranch.id))
    ) {
      throw AppException.notFound('Transfer not found.');
    }
    return this.toDetailView(row);
  }

  // -------------------------------------------------------------------------
  // Create / update drafts
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreateTransferDto,
    ctx: AuditContext,
  ): Promise<TransferDetailView> {
    this.branchScope.assertBranchAccess(user, dto.source.branchId);

    const errors: ApiErrorDetail[] = [];
    const destinationBranchId = dto.destination.branchId ?? dto.source.branchId;
    let destinationWarehouseId = dto.destination.warehouseId ?? null;

    if (dto.kind === TransferType.INTER_BRANCH) {
      if (destinationBranchId === dto.source.branchId) {
        errors.push({
          field: 'destination.branchId',
          message: 'INTER_BRANCH transfers need a destination branch different from the source.',
        });
      }
      if (!destinationWarehouseId) {
        errors.push({
          field: 'destination.warehouseId',
          message: 'INTER_BRANCH transfers need a destination warehouse.',
        });
      }
    } else {
      if (destinationBranchId !== dto.source.branchId) {
        errors.push({
          field: 'destination.branchId',
          message: `${dto.kind} transfers stay within one branch — use INTER_BRANCH to cross branches.`,
        });
      }
      if (dto.kind === TransferType.INTRA_BRANCH) {
        if (!destinationWarehouseId || destinationWarehouseId === dto.source.warehouseId) {
          errors.push({
            field: 'destination.warehouseId',
            message: 'INTRA_BRANCH transfers need a destination warehouse different from the source.',
          });
        }
      } else {
        destinationWarehouseId = destinationWarehouseId ?? dto.source.warehouseId;
        if (destinationWarehouseId !== dto.source.warehouseId) {
          errors.push({
            field: 'destination.warehouseId',
            message: 'LOCATION transfers stay within one warehouse — use INTRA_BRANCH for warehouse-to-warehouse.',
          });
        }
        if (!dto.source.locationId || !dto.destination.locationId) {
          errors.push({
            field: dto.source.locationId ? 'destination.locationId' : 'source.locationId',
            message: 'LOCATION transfers need source and destination locations.',
          });
        } else if (dto.source.locationId === dto.destination.locationId) {
          errors.push({
            field: 'destination.locationId',
            message: 'Source and destination locations are identical.',
          });
        }
      }
    }
    if (errors.length > 0) {
      throw AppException.validation(errors);
    }

    await this.requireWarehouse(dto.source.warehouseId, dto.source.branchId, 'source.warehouseId');
    await this.requireWarehouse(
      destinationWarehouseId as string,
      destinationBranchId,
      'destination.warehouseId',
    );
    await this.requireLocation(dto.source.locationId, dto.source.warehouseId, 'source.locationId');
    await this.requireLocation(
      dto.destination.locationId,
      destinationWarehouseId as string,
      'destination.locationId',
    );
    if (dto.reasonId) {
      const reason = await this.prisma.lookupValue.findFirst({
        where: { id: dto.reasonId, isActive: true },
        select: { id: true },
      });
      if (!reason) {
        throw AppException.validation([
          { field: 'reasonId', message: 'Reason lookup value does not exist or is inactive.' },
        ]);
      }
    }
    const prepared = await this.prepareLines(dto.lines);

    const transferDate = this.toDate(dto.transferDate ?? new Date().toISOString());
    const created = await this.prisma.$transaction(async (tx) => {
      const year = transferDate.getUTCFullYear();
      const sequence = await this.sequences.next(tx, transferSequenceKey(year));
      const transfer = await tx.transfer.create({
        data: {
          transferNumber: formatTransferNumber(year, sequence),
          type: dto.kind,
          status: TransferStatus.DRAFT,
          sourceBranchId: dto.source.branchId,
          sourceWarehouseId: dto.source.warehouseId,
          sourceLocationId: dto.source.locationId ?? null,
          destinationBranchId,
          destinationWarehouseId,
          destinationLocationId: dto.destination.locationId ?? null,
          transferDate,
          reasonId: dto.reasonId ?? null,
          notes: dto.notes ?? null,
          createdById: user.id,
        },
        select: { id: true, transferNumber: true },
      });
      await tx.transferLine.createMany({
        data: prepared.map((line, index) => ({
          transferId: transfer.id,
          lineNumber: index + 1,
          itemId: line.itemId,
          lotId: line.lotId,
          uomId: line.uomId,
          quantity: line.quantity,
          baseQuantity: line.baseQuantity,
          notes: line.notes,
        })),
      });
      return transfer;
    });

    await this.audit.log({
      action: 'transfer.created',
      resourceType: 'transfer',
      resourceId: created.id,
      branchId: dto.source.branchId,
      newValues: {
        transferNumber: created.transferNumber,
        kind: dto.kind,
        destinationBranchId,
        lineCount: prepared.length,
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateTransferDto,
    ctx: AuditContext,
  ): Promise<TransferDetailView> {
    const transfer = await this.requireTransfer(user, id);
    this.branchScope.assertBranchAccess(user, transfer.sourceBranchId);
    if (!canTransferTransition(transfer.status, 'update')) {
      throw AppException.invalidStateTransition(
        transferTransitionError(transfer.status, 'update'),
      );
    }
    const prepared = dto.lines ? await this.prepareLines(dto.lines) : null;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.transfer.updateMany({
        where: { id, version: dto.version, status: TransferStatus.DRAFT },
        data: {
          ...(dto.transferDate
            ? { transferDate: this.toDate(dto.transferDate) }
            : {}),
          ...(dto.reasonId !== undefined ? { reasonId: dto.reasonId } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.versionConflict();
      }
      if (prepared) {
        await tx.transferLine.deleteMany({ where: { transferId: id } });
        await tx.transferLine.createMany({
          data: prepared.map((line, index) => ({
            transferId: id,
            lineNumber: index + 1,
            itemId: line.itemId,
            lotId: line.lotId,
            uomId: line.uomId,
            quantity: line.quantity,
            baseQuantity: line.baseQuantity,
            notes: line.notes,
          })),
        });
      }
    });

    await this.audit.log({
      action: 'transfer.updated',
      resourceType: 'transfer',
      resourceId: id,
      branchId: transfer.sourceBranchId,
      oldValues: { version: dto.version },
      newValues: { linesReplaced: Boolean(prepared) },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Workflow: submit / approve / reject / cancel
  // -------------------------------------------------------------------------

  async submit(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<TransferDetailView> {
    const transfer = await this.requireTransfer(user, id);
    this.branchScope.assertBranchAccess(user, transfer.sourceBranchId);
    if (!canTransferTransition(transfer.status, 'submit')) {
      throw AppException.invalidStateTransition(
        transferTransitionError(transfer.status, 'submit'),
      );
    }
    const lineCount = await this.prisma.transferLine.count({
      where: { transferId: id },
    });
    if (lineCount === 0) {
      throw AppException.validation([
        { field: 'lines', message: 'A transfer needs at least one line before submission.' },
      ]);
    }

    // Phase 6 approval engine: route through the most specific matching
    // active workflow (source/destination branch scope, transfer type,
    // quantity thresholds). No match → auto-approve exactly as before.
    const now = new Date();
    const totals = await this.prisma.transferLine.aggregate({
      where: { transferId: id },
      _sum: { baseQuantity: true },
    });
    const routed = await this.approvals.routeSubmit(
      {
        resourceType: 'TRANSFER',
        resourceId: id,
        resourceNumber: transfer.transferNumber,
        branchId: transfer.sourceBranchId,
        extraBranchIds: [transfer.destinationBranchId],
        subtype: transfer.type,
        quantity: totals._sum.baseQuantity,
        requester: user,
      },
      async (tx) => {
        const claimed = await tx.transfer.updateMany({
          where: { id, status: TransferStatus.DRAFT },
          data: {
            status: TransferStatus.PENDING_APPROVAL,
            submittedAt: now,
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The transfer was modified concurrently. Refetch and retry.',
          );
        }
      },
      ctx,
    );

    const autoApproved = !routed;
    if (autoApproved) {
      const claimed = await this.prisma.transfer.updateMany({
        where: { id, status: TransferStatus.DRAFT },
        data: {
          status: TransferStatus.APPROVED,
          submittedAt: now,
          approvedById: user.id,
          approvedAt: now,
          notes: this.appendNote(
            transfer.notes,
            '[auto-approved on submit: no approval workflow matched]',
          ),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.invalidStateTransition(
          'The transfer was modified concurrently. Refetch and retry.',
        );
      }
    }

    await this.audit.log({
      action: autoApproved
        ? 'transfer.submitted_auto_approved'
        : 'transfer.submitted',
      resourceType: 'transfer',
      resourceId: id,
      branchId: transfer.sourceBranchId,
      oldValues: { status: transfer.status },
      newValues: {
        status: autoApproved
          ? TransferStatus.APPROVED
          : TransferStatus.PENDING_APPROVAL,
        autoApproved,
        ...(routed
          ? { workflowCode: routed.workflowCode, requestId: routed.requestId }
          : {}),
      },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async approve(
    user: AuthUser,
    id: string,
    dto: ApproveTransferDto,
    ctx: AuditContext,
  ): Promise<TransferDetailView> {
    const transfer = await this.requireTransfer(user, id);
    if (!canTransferTransition(transfer.status, 'approve')) {
      throw AppException.invalidStateTransition(
        transferTransitionError(transfer.status, 'approve'),
      );
    }
    // Phase 6: engine-managed transfers are decided through the engine.
    const handled = await this.approvals.actOnResource(
      user,
      'TRANSFER',
      id,
      'APPROVE',
      dto.comment,
      ctx,
    );
    if (handled) {
      return this.getById(user, id);
    }
    this.assertNotSelfApproval(user, transfer.createdById);

    const claimed = await this.prisma.transfer.updateMany({
      where: { id, status: TransferStatus.PENDING_APPROVAL },
      data: {
        status: TransferStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
        ...(dto.comment
          ? { notes: this.appendNote(transfer.notes, `[approval: ${dto.comment}]`) }
          : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The transfer was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'transfer.approved',
      resourceType: 'transfer',
      resourceId: id,
      branchId: transfer.sourceBranchId,
      oldValues: { status: transfer.status },
      newValues: { status: TransferStatus.APPROVED, comment: dto.comment ?? null },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async reject(
    user: AuthUser,
    id: string,
    dto: RejectTransferDto,
    ctx: AuditContext,
  ): Promise<TransferDetailView> {
    const transfer = await this.requireTransfer(user, id);
    if (!canTransferTransition(transfer.status, 'reject')) {
      throw AppException.invalidStateTransition(
        transferTransitionError(transfer.status, 'reject'),
      );
    }
    // Phase 6: engine-managed transfers are decided through the engine.
    const handled = await this.approvals.actOnResource(
      user,
      'TRANSFER',
      id,
      'REJECT',
      dto.comment,
      ctx,
    );
    if (handled) {
      return this.getById(user, id);
    }
    this.assertNotSelfApproval(user, transfer.createdById);

    const claimed = await this.prisma.transfer.updateMany({
      where: { id, status: TransferStatus.PENDING_APPROVAL },
      data: {
        status: TransferStatus.REJECTED,
        notes: this.appendNote(transfer.notes, `[rejected: ${dto.comment}]`),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The transfer was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'transfer.rejected',
      resourceType: 'transfer',
      resourceId: id,
      branchId: transfer.sourceBranchId,
      oldValues: { status: transfer.status },
      newValues: { status: TransferStatus.REJECTED },
      reason: dto.comment,
      ...ctx,
    });
    return this.getById(user, id);
  }

  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelTransferDto,
    ctx: AuditContext,
  ): Promise<TransferDetailView> {
    const transfer = await this.requireTransfer(user, id);
    this.branchScope.assertBranchAccess(user, transfer.sourceBranchId);
    if (!canTransferTransition(transfer.status, 'cancel')) {
      throw AppException.invalidStateTransition(
        transferTransitionError(transfer.status, 'cancel'),
      );
    }

    const claimed = await this.prisma.transfer.updateMany({
      where: { id, status: transfer.status },
      data: {
        status: TransferStatus.CANCELED,
        canceledById: user.id,
        canceledAt: new Date(),
        notes: this.appendNote(transfer.notes, `[canceled: ${dto.reason}]`),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The transfer was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'transfer.canceled',
      resourceType: 'transfer',
      resourceId: id,
      branchId: transfer.sourceBranchId,
      oldValues: { status: transfer.status },
      newValues: { status: TransferStatus.CANCELED },
      reason: dto.reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Dispatch (source-branch action, Idempotency-Key required)
  // -------------------------------------------------------------------------

  async dispatch(
    user: AuthUser,
    id: string,
    idempotencyKey: string | undefined,
    ctx: AuditContext,
  ): Promise<TransferDetailView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const transfer = await this.requireTransferWithLines(user, id);
    this.branchScope.assertBranchAccess(user, transfer.sourceBranchId);

    const replayed = await this.checkLegReplay(user, key, id, 'dispatch');
    if (replayed) {
      return replayed;
    }
    if (!canTransferTransition(transfer.status, 'dispatch')) {
      throw AppException.invalidStateTransition(
        transferTransitionError(transfer.status, 'dispatch'),
      );
    }

    const interBranch = transfer.type === TransferType.INTER_BRANCH;
    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const claimed = await tx.transfer.updateMany({
          where: { id, status: TransferStatus.APPROVED },
          data: {
            status: interBranch ? TransferStatus.IN_TRANSIT : TransferStatus.RECEIVED,
            dispatchedById: user.id,
            dispatchedAt: now,
            ...(interBranch ? {} : { completedAt: now }),
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The transfer was modified concurrently. Refetch and retry.',
          );
        }

        const txnId = await this.createLegTransaction(tx, user.id, transfer, {
          leg: interBranch ? 'OUT' : 'MOVE',
          idempotencyKey: key,
          now,
        });
        await this.posting.postWithinTx(tx, txnId, user.id, {
          idempotencyKey: key,
        });

        for (const line of transfer.lines) {
          if (interBranch) {
            // Stock leaves the source on-hand bucket into the destination's
            // in-transit bucket (spec §13: in-transfer shown separately).
            const result = await this.posting.applyInTransitDelta(
              tx,
              {
                itemId: line.itemId as string,
                branchId: transfer.destinationBranchId,
                warehouseId: transfer.destinationWarehouseId as string,
                storageLocationId: null,
                lotId: line.lotId,
              },
              line.baseQuantity as Prisma.Decimal,
            );
            if (!result.ok) {
              throw AppException.invalidStateTransition(
                'In-transit bucket update failed — retry the dispatch.',
              );
            }
          }
          await tx.transferLine.update({
            where: { id: line.id },
            data: {
              dispatchedQuantity: line.quantity as Prisma.Decimal,
              ...(interBranch
                ? {}
                : { receivedQuantity: line.quantity as Prisma.Decimal }),
            },
          });
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replayedAfterRace = await this.checkLegReplay(user, key, id, 'dispatch');
        if (replayedAfterRace) {
          return replayedAfterRace;
        }
      }
      throw error;
    }

    await this.audit.log({
      action: 'transfer.dispatched',
      resourceType: 'transfer',
      resourceId: id,
      branchId: transfer.sourceBranchId,
      oldValues: { status: transfer.status },
      newValues: {
        status: interBranch ? TransferStatus.IN_TRANSIT : TransferStatus.RECEIVED,
        immediate: !interBranch,
      },
      metadata: { idempotencyKey: key },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Receive (destination-branch action, Idempotency-Key required)
  // -------------------------------------------------------------------------

  async receive(
    user: AuthUser,
    id: string,
    idempotencyKey: string | undefined,
    dto: ReceiveTransferDto,
    ctx: AuditContext,
  ): Promise<TransferDetailView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const transfer = await this.requireTransferWithLines(user, id);
    this.branchScope.assertBranchAccess(user, transfer.destinationBranchId);

    const replayed = await this.checkLegReplay(user, key, id, 'receive');
    if (replayed) {
      return replayed;
    }
    if (!canTransferTransition(transfer.status, 'receive')) {
      throw AppException.invalidStateTransition(
        transferTransitionError(transfer.status, 'receive'),
      );
    }
    if (transfer.type !== TransferType.INTER_BRANCH) {
      throw AppException.invalidStateTransition(
        'Intra-branch transfers complete at dispatch — there is nothing to receive.',
      );
    }

    const counts = this.validateReceiveCounts(transfer.lines, dto);
    await this.requireLocation(
      dto.damagedLocationId,
      transfer.destinationWarehouseId as string,
      'damagedLocationId',
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const claimed = await tx.transfer.updateMany({
          where: { id, status: transfer.status },
          data: {
            status: TransferStatus.RECEIVED,
            completedAt: now,
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The transfer was modified concurrently. Refetch and retry.',
          );
        }

        // Receipt record (acknowledgment trail, spec §16).
        const year = now.getUTCFullYear();
        const receiptSeq = await this.sequences.next(
          tx,
          transferReceiptSequenceKey(year),
        );
        const receipt = await tx.transferReceipt.create({
          data: {
            transferId: id,
            receiptNumber: formatTransferReceiptNumber(year, receiptSeq),
            receivedById: user.id,
            receivedAt: now,
            notes: dto.notes ?? null,
          },
          select: { id: true },
        });
        for (const count of counts) {
          await tx.transferReceiptLine.create({
            data: {
              transferReceiptId: receipt.id,
              transferLineId: count.line.id,
              receivedQuantity: count.received,
              damagedQuantity: count.damaged,
              shortQuantity: count.short,
              rejectedQuantity: new Prisma.Decimal(0),
              conditionId: count.conditionId,
              notes: count.notes,
            },
          });
          await tx.transferLine.update({
            where: { id: count.line.id },
            data: {
              receivedQuantity: count.received,
              damagedQuantity: count.damaged,
              shortQuantity: count.short,
            },
          });
        }

        // Destination-in leg: received + damaged stock physically arrives
        // (damaged goes to the damaged/quarantine location); short quantities
        // never arrive — the loss stays visible on the transfer line and the
        // formal source-side write-off adjustment lands with Phase 6 approvals.
        const txnId = await this.createLegTransaction(tx, user.id, transfer, {
          leg: 'IN',
          idempotencyKey: key,
          now,
          receiveCounts: counts,
          damagedLocationId: dto.damagedLocationId ?? null,
        });
        await this.posting.postWithinTx(tx, txnId, user.id, {
          idempotencyKey: key,
        });

        // Clear the in-transit bucket for the full dispatched quantity —
        // everything is now resolved as received, damaged, or short.
        for (const count of counts) {
          const result = await this.posting.applyInTransitDelta(
            tx,
            {
              itemId: count.line.itemId as string,
              branchId: transfer.destinationBranchId,
              warehouseId: transfer.destinationWarehouseId as string,
              storageLocationId: null,
              lotId: count.line.lotId,
            },
            (count.line.baseQuantity as Prisma.Decimal).neg(),
          );
          if (!result.ok) {
            throw AppException.invalidStateTransition(
              'In-transit bucket is out of sync with the dispatch — refetch and retry.',
            );
          }
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replayedAfterRace = await this.checkLegReplay(user, key, id, 'receive');
        if (replayedAfterRace) {
          return replayedAfterRace;
        }
      }
      throw error;
    }

    await this.audit.log({
      action: 'transfer.received',
      resourceType: 'transfer',
      resourceId: id,
      branchId: transfer.destinationBranchId,
      oldValues: { status: transfer.status },
      newValues: {
        status: TransferStatus.RECEIVED,
        lines: counts.map((count) => ({
          lineNumber: count.line.lineNumber,
          received: count.received.toString(),
          damaged: count.damaged.toString(),
          short: count.short.toString(),
        })),
      },
      metadata: { idempotencyKey: key },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Leg-transaction construction
  // -------------------------------------------------------------------------

  private async createLegTransaction(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    transfer: TransferWithLines,
    options: {
      leg: 'OUT' | 'IN' | 'MOVE';
      idempotencyKey: string;
      now: Date;
      receiveCounts?: ReceiveCount[];
      damagedLocationId?: string | null;
    },
  ): Promise<string> {
    const { leg, now } = options;
    const year = now.getUTCFullYear();
    const sequence = await this.sequences.next(
      tx,
      stockTransactionSequenceKey(year),
    );
    const type =
      leg === 'MOVE'
        ? StockTransactionType.LOCATION_TRANSFER
        : leg === 'OUT'
          ? StockTransactionType.INTER_BRANCH_TRANSFER_OUT
          : StockTransactionType.INTER_BRANCH_TRANSFER_IN;
    const branchId =
      leg === 'IN' ? transfer.destinationBranchId : transfer.sourceBranchId;

    const txn = await tx.stockTransaction.create({
      data: {
        transactionNumber: formatStockTransactionNumber(year, sequence),
        type,
        // Created APPROVED and immediately claimed by postWithinTx — the
        // transfer document carries the actual approval trail.
        status: StockDocumentStatus.APPROVED,
        transactionDate: now,
        branchId,
        sourceBranchId: transfer.sourceBranchId,
        destinationBranchId: transfer.destinationBranchId,
        sourceWarehouseId: leg === 'IN' ? null : transfer.sourceWarehouseId,
        destinationWarehouseId:
          leg === 'OUT' ? transfer.destinationWarehouseId : (transfer.destinationWarehouseId ?? null),
        transferId: transfer.id,
        reasonId: transfer.reasonId,
        notes: `${leg === 'OUT' ? 'Dispatch' : leg === 'IN' ? 'Receipt' : 'Movement'} leg of transfer ${transfer.transferNumber}`,
        createdById: actorUserId,
        submittedAt: now,
        approvedById: actorUserId,
        approvedAt: now,
      },
      select: { id: true },
    });

    let lineNumber = 0;
    if (leg === 'IN') {
      for (const count of options.receiveCounts ?? []) {
        const ratio = (count.line.baseQuantity as Prisma.Decimal).div(
          count.line.quantity as Prisma.Decimal,
        );
        if (count.received.gt(0)) {
          lineNumber += 1;
          await tx.stockTransactionLine.create({
            data: {
              transactionId: txn.id,
              lineNumber,
              itemId: count.line.itemId as string,
              lotId: count.line.lotId,
              destinationLocationId: transfer.destinationLocationId,
              enteredUomId: count.line.uomId as string,
              enteredQuantity: count.received,
              baseQuantity: count.received.mul(ratio).toDecimalPlaces(4),
              notes: null,
            },
          });
        }
        if (count.damaged.gt(0)) {
          lineNumber += 1;
          await tx.stockTransactionLine.create({
            data: {
              transactionId: txn.id,
              lineNumber,
              itemId: count.line.itemId as string,
              lotId: count.line.lotId,
              destinationLocationId:
                options.damagedLocationId ?? transfer.destinationLocationId,
              enteredUomId: count.line.uomId as string,
              enteredQuantity: count.damaged,
              baseQuantity: count.damaged.mul(ratio).toDecimalPlaces(4),
              notes: `Damaged in transit${count.notes ? `: ${count.notes}` : ''}`,
            },
          });
        }
      }
    } else {
      for (const line of transfer.lines) {
        lineNumber += 1;
        await tx.stockTransactionLine.create({
          data: {
            transactionId: txn.id,
            lineNumber,
            itemId: line.itemId as string,
            lotId: line.lotId,
            sourceLocationId: transfer.sourceLocationId,
            destinationLocationId:
              leg === 'MOVE' ? transfer.destinationLocationId : null,
            enteredUomId: line.uomId as string,
            enteredQuantity: line.quantity as Prisma.Decimal,
            baseQuantity: line.baseQuantity as Prisma.Decimal,
            notes: line.notes,
          },
        });
      }
    }
    return txn.id;
  }

  // -------------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------------

  /** Validates lines + normalizes to base units (Phase 2 conversion graph). */
  private async prepareLines(
    lines: TransferLineDto[],
  ): Promise<PreparedTransferLine[]> {
    const errors: ApiErrorDetail[] = [];
    const itemIds = [...new Set(lines.map((line) => line.itemId))];
    const lotIds = [
      ...new Set(lines.map((line) => line.lotId).filter((v): v is string => !!v)),
    ];

    const [items, globalConversions, lots] = await Promise.all([
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
    ]);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));

    const prepared: PreparedTransferLine[] = [];
    lines.forEach((line, index) => {
      const field = (name: string) => `lines[${index}].${name}`;
      const item = itemById.get(line.itemId);
      if (!item || !item.isActive) {
        errors.push({
          field: field('itemId'),
          message: item ? `Item ${item.sku} is inactive.` : 'Item does not exist.',
        });
        return;
      }
      if (item.trackingMethod === TrackingMethod.SERIAL) {
        errors.push({
          field: field('itemId'),
          message: `${item.sku} is serialized — asset transfer lines arrive with the Phase 3 assets module.`,
        });
        return;
      }
      let lotId: string | null = null;
      if (item.trackingMethod === TrackingMethod.LOT) {
        if (!line.lotId) {
          errors.push({
            field: field('lotId'),
            message: `${item.sku} is LOT-tracked: lotId is required.`,
          });
          return;
        }
        const lot = lotById.get(line.lotId);
        if (!lot || lot.itemId !== item.id) {
          errors.push({
            field: field('lotId'),
            message: 'Lot does not exist or belongs to a different item.',
          });
          return;
        }
        lotId = lot.id;
      } else if (line.lotId) {
        errors.push({ field: field('lotId'), message: `${item.sku} is not LOT-tracked.` });
        return;
      }

      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.lte(0)) {
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
          message: `No UOM conversion path to the base unit of ${item.sku}.`,
        });
        return;
      }
      const baseQuantity = quantity
        .mul(new Prisma.Decimal(factor.toString()))
        .toDecimalPlaces(4);
      if (baseQuantity.lte(0)) {
        errors.push({
          field: field('quantity'),
          message: 'Normalized base quantity rounds to zero.',
        });
        return;
      }
      prepared.push({
        itemId: item.id,
        lotId,
        uomId: line.uomId,
        quantity,
        baseQuantity,
        notes: line.notes ?? null,
      });
    });

    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
    return prepared;
  }

  private validateReceiveCounts(
    lines: TransferWithLines['lines'],
    dto: ReceiveTransferDto,
  ): ReceiveCount[] {
    const errors: ApiErrorDetail[] = [];
    const byLineId = new Map(lines.map((line) => [line.id, line]));
    const seen = new Set<string>();
    const counts: ReceiveCount[] = [];

    dto.lines.forEach((entry, index) => {
      const field = (name: string) => `lines[${index}].${name}`;
      const line = byLineId.get(entry.lineId);
      if (!line) {
        errors.push({ field: field('lineId'), message: 'Not a line of this transfer.' });
        return;
      }
      if (seen.has(entry.lineId)) {
        errors.push({ field: field('lineId'), message: 'Duplicate line entry.' });
        return;
      }
      seen.add(entry.lineId);

      const received = new Prisma.Decimal(entry.received);
      const damaged = new Prisma.Decimal(entry.damaged ?? 0);
      const short = new Prisma.Decimal(entry.short ?? 0);
      const rejected = new Prisma.Decimal(entry.rejected ?? 0);
      if (!rejected.isZero()) {
        errors.push({
          field: field('rejected'),
          message:
            'Rejected-and-returned quantities are not supported yet (the return-transfer flow arrives with Phase 6) — receive as damaged or short.',
        });
        return;
      }
      const dispatched = line.dispatchedQuantity as Prisma.Decimal;
      if (!received.add(damaged).add(short).eq(dispatched)) {
        errors.push({
          field: field('received'),
          message: `received + damaged + short must equal the dispatched quantity (${dispatched.toString()}).`,
        });
        return;
      }
      if ((damaged.gt(0) || short.gt(0)) && !entry.notes && !dto.notes) {
        errors.push({
          field: field('notes'),
          message: 'Damaged/short lines require inspection notes (spec §25).',
        });
        return;
      }
      counts.push({
        line,
        received,
        damaged,
        short,
        conditionId: entry.conditionId ?? null,
        notes: entry.notes ?? null,
      });
    });

    for (const line of lines) {
      if (!seen.has(line.id)) {
        errors.push({
          field: 'lines',
          message: `Line ${line.lineNumber} has no receive entry — every dispatched line must be resolved.`,
        });
      }
    }
    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
    return counts;
  }

  /** Replay/conflict resolution for dispatch + receive idempotency keys. */
  private async checkLegReplay(
    user: AuthUser,
    key: string,
    transferId: string,
    action: 'dispatch' | 'receive',
  ): Promise<TransferDetailView | null> {
    const existing = await this.prisma.stockTransaction.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, transferId: true, type: true },
    });
    if (!existing) {
      return null;
    }
    const expectedTypes: StockTransactionType[] =
      action === 'dispatch'
        ? [
            StockTransactionType.INTER_BRANCH_TRANSFER_OUT,
            StockTransactionType.LOCATION_TRANSFER,
          ]
        : [StockTransactionType.INTER_BRANCH_TRANSFER_IN];
    if (
      existing.transferId !== transferId ||
      !expectedTypes.includes(existing.type)
    ) {
      throw new AppException(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used for a different operation.',
      );
    }
    return this.getById(user, transferId);
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

  private assertNotSelfApproval(user: AuthUser, createdById: string): void {
    if (createdById === user.id) {
      throw new AppException(
        409,
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot approve or reject your own transfer.',
      );
    }
  }

  private async requireWarehouse(
    warehouseId: string,
    branchId: string,
    field: string,
  ): Promise<void> {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { branchId: true, isActive: true },
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
  }

  private async requireLocation(
    locationId: string | undefined,
    warehouseId: string,
    field: string,
  ): Promise<void> {
    if (!locationId) {
      return;
    }
    const location = await this.prisma.storageLocation.findUnique({
      where: { id: locationId },
      select: { warehouseId: true, isActive: true },
    });
    if (!location || !location.isActive) {
      throw AppException.validation([
        { field, message: 'Storage location does not exist or is inactive.' },
      ]);
    }
    if (location.warehouseId !== warehouseId) {
      throw AppException.validation([
        { field, message: 'Storage location belongs to a different warehouse.' },
      ]);
    }
  }

  private async requireTransfer(user: AuthUser, id: string) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      select: {
        id: true,
        transferNumber: true,
        type: true,
        status: true,
        sourceBranchId: true,
        destinationBranchId: true,
        createdById: true,
        notes: true,
      },
    });
    if (
      !transfer ||
      (!this.branchScope.canAccess(user, transfer.sourceBranchId) &&
        !this.branchScope.canAccess(user, transfer.destinationBranchId))
    ) {
      throw AppException.notFound('Transfer not found.');
    }
    return transfer;
  }

  private async requireTransferWithLines(user: AuthUser, id: string) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (
      !transfer ||
      (!this.branchScope.canAccess(user, transfer.sourceBranchId) &&
        !this.branchScope.canAccess(user, transfer.destinationBranchId))
    ) {
      throw AppException.notFound('Transfer not found.');
    }
    return transfer;
  }

  private appendNote(notes: string | null, addition: string): string {
    return notes ? `${notes}\n${addition}` : addition;
  }

  private toDate(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }

  private toView(row: TransferListRow): TransferView {
    return { ...row, transferDate: row.transferDate.toISOString().slice(0, 10) };
  }

  private toDetailView(row: TransferDetailRow): TransferDetailView {
    const { lines, receipts, stockTransactions, ...head } = row;
    return {
      ...this.toView(head),
      lines: lines.map((line) => ({
        ...line,
        quantity: line.quantity?.toString() ?? null,
        baseQuantity: line.baseQuantity?.toString() ?? null,
        dispatchedQuantity: line.dispatchedQuantity.toString(),
        receivedQuantity: line.receivedQuantity.toString(),
        damagedQuantity: line.damagedQuantity.toString(),
        shortQuantity: line.shortQuantity.toString(),
        rejectedQuantity: line.rejectedQuantity.toString(),
      })),
      receipts: receipts.map((receipt) => ({
        ...receipt,
        lines: receipt.lines.map((line) => ({
          ...line,
          receivedQuantity: line.receivedQuantity.toString(),
          damagedQuantity: line.damagedQuantity.toString(),
          shortQuantity: line.shortQuantity.toString(),
          rejectedQuantity: line.rejectedQuantity.toString(),
        })),
      })),
      stockTransactions,
    };
  }
}

type TransferWithLines = Prisma.TransferGetPayload<{
  include: { lines: true };
}>;

interface ReceiveCount {
  line: TransferWithLines['lines'][number];
  received: Prisma.Decimal;
  damaged: Prisma.Decimal;
  short: Prisma.Decimal;
  conditionId: string | null;
  notes: string | null;
}
