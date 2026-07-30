import { Injectable } from '@nestjs/common';
import {
  AssetAssignmentStatus,
  AssetLifecycleStatus,
  StockDocumentStatus,
  StockTransactionType,
  type Prisma,
} from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';

const OPEN_ASSIGNMENT_STATUSES: AssetAssignmentStatus[] = [
  AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
  AssetAssignmentStatus.ACTIVE,
];

const CUSTODY_ASSET_SELECT = {
  id: true,
  assetTag: true,
  serialNumber: true,
  status: true,
  item: { select: { id: true, sku: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  condition: { select: { id: true, code: true, name: true } },
} satisfies Prisma.AssetSelect;

const CUSTODY_ASSIGNMENT_SELECT = {
  id: true,
  status: true,
  assignedAt: true,
  expectedReturnAt: true,
  acknowledgedAt: true,
  conditionAtIssue: { select: { id: true, code: true, name: true } },
  issueNotes: true,
  asset: { select: CUSTODY_ASSET_SELECT },
} satisfies Prisma.AssetAssignmentSelect;

type CustodyAssignmentRow = Prisma.AssetAssignmentGetPayload<{
  select: typeof CUSTODY_ASSIGNMENT_SELECT;
}>;

export interface EmployeeAcknowledgmentsView {
  /** Assignments awaiting the employee's issue acknowledgment. */
  outstanding: CustodyAssignmentRow[];
  /** Open assignments whose expected return date has passed. */
  overdueReturns: CustodyAssignmentRow[];
}

/**
 * Employee custody read endpoints (api-outline 3.1, P3 rows):
 * currently assigned assets, outstanding acknowledgments + overdue expected
 * returns, and consumable issuance history (read from posted stock issues —
 * tolerates an empty ledger until the inventory module posts documents).
 */
@Injectable()
export class EmployeeAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  /** GET /employees/:id/assets — assets currently in the employee's custody. */
  async currentAssets(user: AuthUser, employeeId: string) {
    await this.requireEmployeeInScope(user, employeeId);
    const assignments = await this.prisma.assetAssignment.findMany({
      where: {
        employeeId,
        status: { in: OPEN_ASSIGNMENT_STATUSES },
        asset: { status: AssetLifecycleStatus.ASSIGNED },
      },
      orderBy: { assignedAt: 'desc' },
      select: CUSTODY_ASSIGNMENT_SELECT,
    });
    return assignments;
  }

  /** GET /employees/:id/acknowledgments */
  async acknowledgments(
    user: AuthUser,
    employeeId: string,
  ): Promise<EmployeeAcknowledgmentsView> {
    await this.requireEmployeeInScope(user, employeeId);
    const [outstanding, overdueReturns] = await Promise.all([
      this.prisma.assetAssignment.findMany({
        where: {
          employeeId,
          status: AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
        },
        orderBy: { assignedAt: 'asc' },
        select: CUSTODY_ASSIGNMENT_SELECT,
      }),
      this.prisma.assetAssignment.findMany({
        where: {
          employeeId,
          status: { in: OPEN_ASSIGNMENT_STATUSES },
          expectedReturnAt: { lt: new Date() },
          returnedAt: null,
        },
        orderBy: { expectedReturnAt: 'asc' },
        select: CUSTODY_ASSIGNMENT_SELECT,
      }),
    ]);
    return { outstanding, overdueReturns };
  }

  /**
   * GET /employees/:id/issuances — consumable issuance history, read from
   * POSTED stock-issue transactions referencing the employee. Returns an
   * empty list until the inventory module posts issues (never faked).
   */
  async issuances(user: AuthUser, employeeId: string) {
    await this.requireEmployeeInScope(user, employeeId);
    return this.prisma.stockTransaction.findMany({
      where: {
        employeeId,
        type: {
          in: [
            StockTransactionType.ISSUE_TO_EMPLOYEE,
            StockTransactionType.MAINTENANCE_ISSUE,
          ],
        },
        status: StockDocumentStatus.POSTED,
      },
      orderBy: { postedAt: 'desc' },
      select: {
        id: true,
        transactionNumber: true,
        type: true,
        transactionDate: true,
        postedAt: true,
        notes: true,
        branch: { select: { id: true, code: true, name: true } },
        sourceWarehouse: { select: { id: true, code: true, name: true } },
        reason: { select: { code: true, name: true } },
        lines: {
          select: {
            id: true,
            lineNumber: true,
            enteredQuantity: true,
            baseQuantity: true,
            enteredUom: { select: { id: true, code: true } },
            item: { select: { id: true, sku: true, name: true } },
          },
          orderBy: { lineNumber: 'asc' },
        },
      },
    });
  }

  /** Out-of-scope employees are 404 (no existence leak). */
  private async requireEmployeeInScope(
    user: AuthUser,
    employeeId: string,
  ): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, branchId: true },
    });
    if (!employee || !this.branchScope.canAccess(user, employee.branchId)) {
      throw AppException.notFound('Employee not found.');
    }
  }
}
