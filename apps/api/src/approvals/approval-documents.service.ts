import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PurchaseOrderStatus,
  StockDocumentStatus,
  TransferStatus,
} from '@prisma/client';
import { NOTIFICATION_LINKS } from '@gemerp/shared';
import { AppException } from '../common/errors/app.exception';
import type { ApprovalResourceType } from './approval-rules';

export type ApprovalOutcome = 'APPROVE' | 'REJECT' | 'RETURN';

export interface DocumentContext {
  branchId: string;
  number: string;
  requesterId: string;
  /** Deep-link path of the document itself (notifications to the requester). */
  link: string;
}

function appendNote(notes: string | null, addition: string): string {
  return notes ? `${notes}\n${addition}` : addition;
}

/**
 * Executes the DOCUMENT side of a finalized approval decision (api-outline
 * 7.2: "approve advances step or finalizes — then the document's own
 * transition executes"). One claim-style UPDATE per document type, mirroring
 * the exact semantics the document services implement:
 *
 * - approve  → APPROVED (approved-by = the final approver)
 * - reject   → the document's reject path (stock txn/transfer/supplier
 *              return → REJECTED; purchase order → back to DRAFT, its
 *              machine has no resting Rejected state)
 * - return   → back to DRAFT for revision (every type)
 *
 * Lives in the approvals module (plain Prisma writes) so document modules
 * depend on the engine — never the other way around (no module cycles).
 * Claims are guarded on PENDING_APPROVAL; a 409 here means the document
 * moved concurrently (e.g. was withdrawn) and the whole transaction rolls
 * back.
 */
@Injectable()
export class ApprovalDocumentsService {
  /** Fetch the context the engine needs for scoping and notifications. */
  async loadContext(
    tx: Prisma.TransactionClient,
    resourceType: ApprovalResourceType,
    resourceId: string,
  ): Promise<DocumentContext | null> {
    switch (resourceType) {
      case 'STOCK_TRANSACTION': {
        const row = await tx.stockTransaction.findUnique({
          where: { id: resourceId },
          select: {
            branchId: true,
            transactionNumber: true,
            createdById: true,
          },
        });
        return row
          ? {
              branchId: row.branchId,
              number: row.transactionNumber,
              requesterId: row.createdById,
              link: NOTIFICATION_LINKS.stockTransaction(resourceId),
            }
          : null;
      }
      case 'PURCHASE_ORDER': {
        const row = await tx.purchaseOrder.findUnique({
          where: { id: resourceId },
          select: { branchId: true, poNumber: true, createdById: true },
        });
        return row
          ? {
              branchId: row.branchId,
              number: row.poNumber,
              requesterId: row.createdById,
              link: NOTIFICATION_LINKS.purchaseOrder(resourceId),
            }
          : null;
      }
      case 'TRANSFER': {
        const row = await tx.transfer.findUnique({
          where: { id: resourceId },
          select: {
            sourceBranchId: true,
            transferNumber: true,
            createdById: true,
          },
        });
        return row
          ? {
              branchId: row.sourceBranchId,
              number: row.transferNumber,
              requesterId: row.createdById,
              link: NOTIFICATION_LINKS.transfer(resourceId),
            }
          : null;
      }
      case 'SUPPLIER_RETURN': {
        const row = await tx.supplierReturn.findUnique({
          where: { id: resourceId },
          select: { branchId: true, returnNumber: true, createdById: true },
        });
        return row
          ? {
              branchId: row.branchId,
              number: row.returnNumber,
              requesterId: row.createdById,
              // No dedicated supplier-return page yet; the request detail
              // carries the document context.
              link: NOTIFICATION_LINKS.purchaseOrder(resourceId),
            }
          : null;
      }
    }
  }

  /** Apply the finalized outcome inside the engine's database transaction. */
  async applyOutcome(
    tx: Prisma.TransactionClient,
    resourceType: ApprovalResourceType,
    resourceId: string,
    outcome: ApprovalOutcome,
    actorId: string,
    comment: string | undefined,
  ): Promise<void> {
    switch (resourceType) {
      case 'STOCK_TRANSACTION':
        return this.applyStockTransaction(tx, resourceId, outcome, actorId, comment);
      case 'PURCHASE_ORDER':
        return this.applyPurchaseOrder(tx, resourceId, outcome, actorId, comment);
      case 'TRANSFER':
        return this.applyTransfer(tx, resourceId, outcome, actorId, comment);
      case 'SUPPLIER_RETURN':
        return this.applySupplierReturn(tx, resourceId, outcome, actorId, comment);
    }
  }

  private conflict(): never {
    throw AppException.invalidStateTransition(
      'The document is no longer pending approval — it was modified or withdrawn concurrently.',
    );
  }

  private note(outcome: ApprovalOutcome, comment: string | undefined): string {
    switch (outcome) {
      case 'APPROVE':
        return comment ? `[approval: ${comment}]` : '[approved via workflow]';
      case 'REJECT':
        return `[rejected: ${comment ?? ''}]`;
      case 'RETURN':
        return `[returned for revision: ${comment ?? ''}]`;
    }
  }

  private async applyStockTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    outcome: ApprovalOutcome,
    actorId: string,
    comment: string | undefined,
  ): Promise<void> {
    const current = await tx.stockTransaction.findUnique({
      where: { id },
      select: { notes: true },
    });
    const now = new Date();
    const data: Prisma.StockTransactionUncheckedUpdateManyInput =
      outcome === 'APPROVE'
        ? {
            status: StockDocumentStatus.APPROVED,
            approvedById: actorId,
            approvedAt: now,
          }
        : outcome === 'REJECT'
          ? { status: StockDocumentStatus.REJECTED }
          : { status: StockDocumentStatus.DRAFT, submittedAt: null };
    const claimed = await tx.stockTransaction.updateMany({
      where: { id, status: StockDocumentStatus.PENDING_APPROVAL },
      data: {
        ...data,
        notes: appendNote(current?.notes ?? null, this.note(outcome, comment)),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      this.conflict();
    }
  }

  private async applyPurchaseOrder(
    tx: Prisma.TransactionClient,
    id: string,
    outcome: ApprovalOutcome,
    actorId: string,
    comment: string | undefined,
  ): Promise<void> {
    const current = await tx.purchaseOrder.findUnique({
      where: { id },
      select: { notes: true },
    });
    const now = new Date();
    // PO machine has no resting Rejected state (status-transitions §3):
    // both reject and return land the PO back in DRAFT for revision.
    const data: Prisma.PurchaseOrderUncheckedUpdateManyInput =
      outcome === 'APPROVE'
        ? {
            status: PurchaseOrderStatus.APPROVED,
            approvedById: actorId,
            approvedAt: now,
          }
        : { status: PurchaseOrderStatus.DRAFT, submittedAt: null };
    const claimed = await tx.purchaseOrder.updateMany({
      where: { id, status: PurchaseOrderStatus.PENDING_APPROVAL },
      data: {
        ...data,
        notes: appendNote(current?.notes ?? null, this.note(outcome, comment)),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      this.conflict();
    }
  }

  private async applyTransfer(
    tx: Prisma.TransactionClient,
    id: string,
    outcome: ApprovalOutcome,
    actorId: string,
    comment: string | undefined,
  ): Promise<void> {
    const current = await tx.transfer.findUnique({
      where: { id },
      select: { notes: true },
    });
    const now = new Date();
    const data: Prisma.TransferUncheckedUpdateManyInput =
      outcome === 'APPROVE'
        ? {
            status: TransferStatus.APPROVED,
            approvedById: actorId,
            approvedAt: now,
          }
        : outcome === 'REJECT'
          ? { status: TransferStatus.REJECTED }
          : { status: TransferStatus.DRAFT, submittedAt: null };
    const claimed = await tx.transfer.updateMany({
      where: { id, status: TransferStatus.PENDING_APPROVAL },
      data: {
        ...data,
        notes: appendNote(current?.notes ?? null, this.note(outcome, comment)),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      this.conflict();
    }
  }

  private async applySupplierReturn(
    tx: Prisma.TransactionClient,
    id: string,
    outcome: ApprovalOutcome,
    actorId: string,
    comment: string | undefined,
  ): Promise<void> {
    const current = await tx.supplierReturn.findUnique({
      where: { id },
      select: { notes: true },
    });
    const now = new Date();
    const data: Prisma.SupplierReturnUncheckedUpdateManyInput =
      outcome === 'APPROVE'
        ? {
            status: StockDocumentStatus.APPROVED,
            approvedById: actorId,
            approvedAt: now,
          }
        : outcome === 'REJECT'
          ? { status: StockDocumentStatus.REJECTED }
          : { status: StockDocumentStatus.DRAFT };
    const claimed = await tx.supplierReturn.updateMany({
      where: { id, status: StockDocumentStatus.PENDING_APPROVAL },
      data: {
        ...data,
        notes: appendNote(current?.notes ?? null, this.note(outcome, comment)),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      this.conflict();
    }
  }
}
