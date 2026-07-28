import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { EmployeeStatus, type Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  EMPLOYEE_NUMBER_SEQUENCE_KEY,
  formatEmployeeNumber,
} from '../sequences/sequence.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  DeactivateEmployeeDto,
  SeparateEmployeeDto,
} from './dto/employee-actions.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const EMPLOYEE_SELECT = {
  id: true,
  employeeNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  displayName: true,
  workEmail: true,
  workPhone: true,
  status: true,
  startDate: true,
  separationDate: true,
  photoUrl: true,
  notes: true,
  version: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
  position: { select: { id: true, code: true, name: true } },
  supervisor: {
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  user: { select: { id: true, email: true, displayName: true } },
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

export interface EmployeeView {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  displayName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  status: EmployeeStatus;
  startDate: Date | null;
  separationDate: Date | null;
  photoUrl: string | null;
  /** Present only when the caller holds employee.view_notes. */
  notes?: string | null;
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  branch: { id: string; code: string; name: string };
  department: { id: string; code: string; name: string } | null;
  position: { id: string; code: string; name: string } | null;
  supervisor: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    displayName: string | null;
  } | null;
  user: { id: string; email: string; displayName: string } | null;
}

/** Outstanding custody line returned by the separation workflow. */
export interface OutstandingAssetView {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  status: string;
  item: { id: string; sku: string; name: string };
}

export interface SeparationResult {
  employee: EmployeeView;
  /**
   * Assets still in the employee's custody. Assets are NEVER auto-returned;
   * each must go through the Phase 3 return workflow before archival.
   */
  outstandingAssets: OutstandingAssetView[];
}

const SORTABLE = {
  employeeNumber: 'employeeNumber',
  firstName: 'firstName',
  lastName: 'lastName',
  status: 'status',
  startDate: 'startDate',
  createdAt: 'createdAt',
};

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  async list(
    user: AuthUser,
    query: QueryEmployeesDto,
  ): Promise<Paginated<EmployeeView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'employeeNumber',
      direction: 'asc',
    });

    const where: Prisma.EmployeeWhereInput = {};
    if (query.branchId) {
      // Explicitly requesting an out-of-scope branch is a 403 (outline 1.7).
      this.branchScope.assertBranchAccess(user, query.branchId);
      where.branchId = query.branchId;
    } else {
      const filter = this.branchScope.branchFilter(user);
      if (filter) {
        where.branchId = filter;
      }
    }
    if (query.q) {
      where.OR = [
        { employeeNumber: { contains: query.q, mode: 'insensitive' } },
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { displayName: { contains: query.q, mode: 'insensitive' } },
        { workEmail: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.departmentId) {
      where.departmentId = query.departmentId;
    }
    if (query.positionId) {
      where.positionId = query.positionId;
    }
    if (query.status) {
      where.status = query.status;
    }

    const includeNotes = this.canViewNotes(user);
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy,
        skip,
        take,
        select: EMPLOYEE_SELECT,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.toView(row, includeNotes)),
      page,
      pageSize,
      total,
    );
  }

  async getById(user: AuthUser, id: string): Promise<EmployeeView> {
    const row = await this.requireInScope(user, id);
    return this.toView(row, this.canViewNotes(user));
  }

  async create(
    user: AuthUser,
    dto: CreateEmployeeDto,
    ctx: AuditContext,
  ): Promise<EmployeeView> {
    await this.requireBranch(dto.branchId);
    this.branchScope.assertBranchAccess(user, dto.branchId);
    await this.assertReferences(dto.departmentId, dto.positionId, dto.supervisorId);
    await this.assertUserLinkable(dto.userId);

    if (dto.workEmail) {
      const emailTaken = await this.prisma.employee.findUnique({
        where: { workEmail: dto.workEmail },
        select: { id: true },
      });
      if (emailTaken) {
        throw AppException.duplicateCode(
          'An employee with this work email already exists.',
        );
      }
    }
    if (dto.employeeNumber) {
      const numberTaken = await this.prisma.employee.findUnique({
        where: { employeeNumber: dto.employeeNumber },
        select: { id: true },
      });
      if (numberTaken) {
        throw AppException.duplicateCode(
          `Employee number "${dto.employeeNumber}" is already in use.`,
        );
      }
    }

    // Number generation and insert commit atomically (same transaction).
    const created = await this.prisma.$transaction(async (tx) => {
      const employeeNumber =
        dto.employeeNumber ??
        formatEmployeeNumber(
          await this.sequences.next(tx, EMPLOYEE_NUMBER_SEQUENCE_KEY),
        );
      return tx.employee.create({
        data: {
          employeeNumber,
          firstName: dto.firstName,
          middleName: dto.middleName ?? null,
          lastName: dto.lastName,
          displayName: dto.displayName ?? null,
          workEmail: dto.workEmail ?? null,
          workPhone: dto.workPhone ?? null,
          branchId: dto.branchId,
          departmentId: dto.departmentId ?? null,
          positionId: dto.positionId ?? null,
          supervisorId: dto.supervisorId ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          photoUrl: dto.photoUrl ?? null,
          notes: dto.notes ?? null,
          userId: dto.userId ?? null,
        },
        select: EMPLOYEE_SELECT,
      });
    });

    await this.audit.log({
      action: 'employee.created',
      resourceType: 'employee',
      resourceId: created.id,
      branchId: created.branch.id,
      newValues: this.snapshot(created),
      ...ctx,
    });
    return this.toView(created, this.canViewNotes(user));
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateEmployeeDto,
    ctx: AuditContext,
  ): Promise<EmployeeView> {
    const existing = await this.requireInScope(user, id);
    this.assertNotArchived(existing);

    if (dto.branchId && dto.branchId !== existing.branch.id) {
      await this.requireBranch(dto.branchId);
      this.branchScope.assertBranchAccess(user, dto.branchId);
    }
    if (dto.supervisorId === id) {
      throw AppException.validation([
        { field: 'supervisorId', message: 'An employee cannot supervise themselves.' },
      ]);
    }
    await this.assertReferences(
      dto.departmentId ?? undefined,
      dto.positionId ?? undefined,
      dto.supervisorId ?? undefined,
    );
    if (dto.userId && dto.userId !== existing.user?.id) {
      await this.assertUserLinkable(dto.userId);
    }
    if (dto.workEmail && dto.workEmail !== existing.workEmail) {
      const emailTaken = await this.prisma.employee.findUnique({
        where: { workEmail: dto.workEmail },
        select: { id: true },
      });
      if (emailTaken) {
        throw AppException.duplicateCode(
          'An employee with this work email already exists.',
        );
      }
    }

    const data: Prisma.EmployeeUncheckedUpdateManyInput = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.middleName !== undefined ? { middleName: dto.middleName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
      ...(dto.workEmail !== undefined ? { workEmail: dto.workEmail } : {}),
      ...(dto.workPhone !== undefined ? { workPhone: dto.workPhone } : {}),
      ...(dto.startDate !== undefined
        ? { startDate: dto.startDate ? new Date(dto.startDate) : null }
        : {}),
      ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };
    const relationData: Prisma.EmployeeUncheckedUpdateManyInput = {
      ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
      ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
      ...(dto.positionId !== undefined ? { positionId: dto.positionId } : {}),
      ...(dto.supervisorId !== undefined ? { supervisorId: dto.supervisorId } : {}),
      ...(dto.userId !== undefined ? { userId: dto.userId } : {}),
    };

    await this.applyVersionedUpdate(id, dto.version, {
      ...data,
      ...relationData,
    });

    const updated = await this.requireInScope(user, id);
    await this.audit.log({
      action: 'employee.updated',
      resourceType: 'employee',
      resourceId: id,
      branchId: updated.branch.id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
      ...ctx,
    });
    return this.toView(updated, this.canViewNotes(user));
  }

  async activate(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<EmployeeView> {
    const existing = await this.requireInScope(user, id);
    this.assertNotArchived(existing);

    const updated = await this.prisma.employee.update({
      where: { id },
      data: {
        status: EmployeeStatus.ACTIVE,
        separationDate: null,
        version: { increment: 1 },
      },
      select: EMPLOYEE_SELECT,
    });
    await this.audit.log({
      action: 'employee.activated',
      resourceType: 'employee',
      resourceId: id,
      branchId: updated.branch.id,
      oldValues: { status: existing.status, separationDate: existing.separationDate },
      newValues: { status: updated.status, separationDate: null },
      ...ctx,
    });
    return this.toView(updated, this.canViewNotes(user));
  }

  async deactivate(
    user: AuthUser,
    id: string,
    dto: DeactivateEmployeeDto,
    ctx: AuditContext,
  ): Promise<EmployeeView> {
    const existing = await this.requireInScope(user, id);
    this.assertNotArchived(existing);
    if (existing.status === EmployeeStatus.SEPARATED) {
      throw AppException.invalidStateTransition(
        'A separated employee cannot be deactivated. Use activate to rehire.',
      );
    }

    const updated = await this.prisma.employee.update({
      where: { id },
      data: { status: dto.status, version: { increment: 1 } },
      select: EMPLOYEE_SELECT,
    });
    await this.audit.log({
      action: 'employee.deactivated',
      resourceType: 'employee',
      resourceId: id,
      branchId: updated.branch.id,
      oldValues: { status: existing.status },
      newValues: { status: updated.status },
      reason: dto.reason,
      ...ctx,
    });
    return this.toView(updated, this.canViewNotes(user));
  }

  /**
   * Separation workflow: marks the employee SEPARATED and reports every asset
   * still in their custody. Assets are never auto-returned — archival stays
   * blocked until custody is cleared through the Phase 3 return workflow.
   */
  async separate(
    user: AuthUser,
    id: string,
    dto: SeparateEmployeeDto,
    ctx: AuditContext,
  ): Promise<SeparationResult> {
    const existing = await this.requireInScope(user, id);
    this.assertNotArchived(existing);
    if (existing.status === EmployeeStatus.SEPARATED) {
      throw AppException.invalidStateTransition(
        'This employee is already separated.',
      );
    }

    const updated = await this.prisma.employee.update({
      where: { id },
      data: {
        status: EmployeeStatus.SEPARATED,
        separationDate: new Date(dto.separationDate),
        version: { increment: 1 },
      },
      select: EMPLOYEE_SELECT,
    });
    const outstandingAssets = await this.outstandingAssets(id);

    await this.audit.log({
      action: 'employee.separated',
      resourceType: 'employee',
      resourceId: id,
      branchId: updated.branch.id,
      oldValues: { status: existing.status, separationDate: existing.separationDate },
      newValues: {
        status: updated.status,
        separationDate: updated.separationDate,
      },
      metadata: { outstandingAssetCount: outstandingAssets.length },
      ...ctx,
    });
    return {
      employee: this.toView(updated, this.canViewNotes(user)),
      outstandingAssets,
    };
  }

  /** Soft archive — only after separation, and only with custody cleared. */
  async archive(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<EmployeeView> {
    const existing = await this.requireInScope(user, id);
    this.assertNotArchived(existing);
    if (existing.status !== EmployeeStatus.SEPARATED) {
      throw AppException.invalidStateTransition(
        'Only separated employees can be archived. Run the separation workflow first.',
      );
    }
    const outstanding = await this.outstandingAssets(id);
    if (outstanding.length > 0) {
      throw AppException.invalidStateTransition(
        `Cannot archive: ${outstanding.length} asset(s) are still in this employee's custody. ` +
          'Assets must be returned first — they are never auto-returned.',
      );
    }

    const updated = await this.prisma.employee.update({
      where: { id },
      data: { archivedAt: new Date(), version: { increment: 1 } },
      select: EMPLOYEE_SELECT,
    });
    await this.audit.log({
      action: 'employee.archived',
      resourceType: 'employee',
      resourceId: id,
      branchId: updated.branch.id,
      oldValues: { archivedAt: existing.archivedAt },
      newValues: { archivedAt: updated.archivedAt },
      ...ctx,
    });
    return this.toView(updated, this.canViewNotes(user));
  }

  /**
   * Assets currently in the employee's custody. Empty until Phase 3 populates
   * the assets table — the query is real either way, never faked.
   */
  private async outstandingAssets(
    employeeId: string,
  ): Promise<OutstandingAssetView[]> {
    const assets = await this.prisma.asset.findMany({
      where: { custodianId: employeeId, archivedAt: null },
      select: {
        id: true,
        assetTag: true,
        serialNumber: true,
        status: true,
        item: { select: { id: true, sku: true, name: true } },
      },
      orderBy: { assetTag: 'asc' },
    });
    return assets;
  }

  /** Atomic optimistic-concurrency update: 0 rows touched = stale version. */
  private async applyVersionedUpdate(
    id: string,
    version: number,
    data: Prisma.EmployeeUncheckedUpdateManyInput,
  ): Promise<void> {
    const result = await this.prisma.employee.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw AppException.versionConflict();
    }
  }

  /** Direct fetch: out-of-scope records are 404 (no existence leak). */
  private async requireInScope(user: AuthUser, id: string): Promise<EmployeeRow> {
    const row = await this.prisma.employee.findUnique({
      where: { id },
      select: EMPLOYEE_SELECT,
    });
    if (!row || !this.branchScope.canAccess(user, row.branch.id)) {
      throw AppException.notFound('Employee not found.');
    }
    return row;
  }

  private assertNotArchived(row: EmployeeRow): void {
    if (row.archivedAt) {
      throw AppException.invalidStateTransition(
        'This employee record is archived and can no longer be modified.',
      );
    }
  }

  private async requireBranch(branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true },
    });
    if (!branch) {
      throw AppException.notFound('Branch not found.');
    }
  }

  private async assertReferences(
    departmentId?: string,
    positionId?: string,
    supervisorId?: string,
  ): Promise<void> {
    if (departmentId) {
      const department = await this.prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true, isActive: true },
      });
      if (!department || !department.isActive) {
        throw AppException.validation([
          { field: 'departmentId', message: 'Department does not exist or is inactive.' },
        ]);
      }
    }
    if (positionId) {
      const position = await this.prisma.position.findUnique({
        where: { id: positionId },
        select: { id: true, isActive: true },
      });
      if (!position || !position.isActive) {
        throw AppException.validation([
          { field: 'positionId', message: 'Position does not exist or is inactive.' },
        ]);
      }
    }
    if (supervisorId) {
      const supervisor = await this.prisma.employee.findUnique({
        where: { id: supervisorId },
        select: { id: true, archivedAt: true },
      });
      if (!supervisor || supervisor.archivedAt) {
        throw AppException.validation([
          { field: 'supervisorId', message: 'Supervisor does not exist or is archived.' },
        ]);
      }
    }
  }

  /** A linked user must exist, and one user links to at most one employee. */
  private async assertUserLinkable(userId?: string): Promise<void> {
    if (!userId) {
      return;
    }
    const linkedUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!linkedUser) {
      throw AppException.validation([
        { field: 'userId', message: 'User account does not exist.' },
      ]);
    }
    const alreadyLinked = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true, employeeNumber: true },
    });
    if (alreadyLinked) {
      throw AppException.duplicateCode(
        `This user account is already linked to employee ${alreadyLinked.employeeNumber}.`,
      );
    }
  }

  private canViewNotes(user: AuthUser): boolean {
    return (
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.employee.viewNotes)
    );
  }

  /** Audit snapshot — restricted notes are deliberately excluded. */
  private snapshot(row: EmployeeRow) {
    return {
      employeeNumber: row.employeeNumber,
      firstName: row.firstName,
      middleName: row.middleName,
      lastName: row.lastName,
      displayName: row.displayName,
      workEmail: row.workEmail,
      workPhone: row.workPhone,
      branchId: row.branch.id,
      departmentId: row.department?.id ?? null,
      positionId: row.position?.id ?? null,
      supervisorId: row.supervisor?.id ?? null,
      status: row.status,
      startDate: row.startDate,
      separationDate: row.separationDate,
      userId: row.user?.id ?? null,
    };
  }

  private toView(row: EmployeeRow, includeNotes: boolean): EmployeeView {
    const { notes, ...rest } = row;
    return {
      ...rest,
      ...(includeNotes ? { notes } : {}),
    };
  }
}
