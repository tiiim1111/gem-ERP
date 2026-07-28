import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from './dto/department.dto';
import { LookupQueryDto } from './dto/lookup-common.dto';

const DEPARTMENT_SELECT = {
  id: true,
  code: true,
  name: true,
  isActive: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { id: true, code: true, name: true } },
  headEmployee: {
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  _count: { select: { employees: true } },
} satisfies Prisma.DepartmentSelect;

type DepartmentRow = Prisma.DepartmentGetPayload<{
  select: typeof DEPARTMENT_SELECT;
}>;

const SORTABLE = { code: 'code', name: 'name', createdAt: 'createdAt' };

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: LookupQueryDto): Promise<Paginated<DepartmentRow>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'code',
      direction: 'asc',
    });

    const where: Prisma.DepartmentWhereInput = {};
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { name: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [rows, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        orderBy,
        skip,
        take,
        select: DEPARTMENT_SELECT,
      }),
      this.prisma.department.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async getById(id: string): Promise<DepartmentRow> {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: DEPARTMENT_SELECT,
    });
    if (!department) {
      throw AppException.notFound('Department not found.');
    }
    return department;
  }

  async create(
    dto: CreateDepartmentDto,
    ctx: AuditContext,
  ): Promise<DepartmentRow> {
    const duplicate = await this.prisma.department.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `A department with code "${dto.code}" already exists.`,
      );
    }
    await this.assertBranch(dto.branchId);
    await this.assertHeadEmployee(dto.headEmployeeId);

    const department = await this.prisma.department.create({
      data: {
        code: dto.code,
        name: dto.name,
        branchId: dto.branchId ?? null,
        headEmployeeId: dto.headEmployeeId ?? null,
      },
      select: DEPARTMENT_SELECT,
    });
    await this.audit.log({
      action: 'department.created',
      resourceType: 'department',
      resourceId: department.id,
      newValues: this.snapshot(department),
      ...ctx,
    });
    return department;
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    ctx: AuditContext,
  ): Promise<DepartmentRow> {
    const existing = await this.getById(id);
    if (dto.headEmployeeId) {
      await this.assertHeadEmployee(dto.headEmployeeId);
    }
    if (dto.branchId) {
      await this.assertBranch(dto.branchId);
    }

    const department = await this.prisma.department.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.headEmployeeId !== undefined
          ? { headEmployeeId: dto.headEmployeeId }
          : {}),
      },
      select: DEPARTMENT_SELECT,
    });
    await this.audit.log({
      action: 'department.updated',
      resourceType: 'department',
      resourceId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(department),
      ...ctx,
    });
    return department;
  }

  /** Delete-protected once referenced (spec §10). */
  async remove(id: string, ctx: AuditContext): Promise<void> {
    const existing = await this.getById(id);
    const counts = await this.prisma.department.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            employees: true,
            stockTransactions: true,
            assets: true,
            assetAssignments: true,
          },
        },
      },
    });
    const references = Object.values(counts?._count ?? {}).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (references > 0) {
      throw AppException.inUse(
        `This department is referenced by ${references} record(s). Deactivate it instead of deleting.`,
      );
    }

    await this.prisma.department.delete({ where: { id } });
    await this.audit.log({
      action: 'department.deleted',
      resourceType: 'department',
      resourceId: id,
      oldValues: this.snapshot(existing),
      ...ctx,
    });
  }

  private async assertBranch(branchId?: string | null): Promise<void> {
    if (!branchId) {
      return;
    }
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true },
    });
    if (!branch) {
      throw AppException.validation([
        { field: 'branchId', message: 'Branch does not exist.' },
      ]);
    }
  }

  private async assertHeadEmployee(employeeId?: string | null): Promise<void> {
    if (!employeeId) {
      return;
    }
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, archivedAt: true },
    });
    if (!employee || employee.archivedAt) {
      throw AppException.validation([
        {
          field: 'headEmployeeId',
          message: 'Head employee does not exist or is archived.',
        },
      ]);
    }
  }

  private snapshot(department: DepartmentRow) {
    return {
      code: department.code,
      name: department.name,
      isActive: department.isActive,
      branchId: department.branch?.id ?? null,
      headEmployeeId: department.headEmployee?.id ?? null,
    };
  }
}
