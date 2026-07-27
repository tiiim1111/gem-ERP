import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { Prisma, Warehouse } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrgQueryDto } from './dto/org-query.dto';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

const SORTABLE = { code: 'code', name: 'name', createdAt: 'createdAt' };

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Nested listing: an explicitly requested out-of-scope branch is a 403. */
  async listForBranch(
    user: AuthUser,
    branchId: string,
    query: OrgQueryDto,
  ): Promise<Paginated<Warehouse>> {
    await this.requireBranch(branchId);
    this.branchScope.assertBranchAccess(user, branchId);

    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'code',
      direction: 'asc',
    });

    const where: Prisma.WarehouseWhereInput = { branchId };
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
      this.prisma.warehouse.findMany({ where, orderBy, skip, take }),
      this.prisma.warehouse.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async create(
    user: AuthUser,
    branchId: string,
    dto: CreateWarehouseDto,
    ctx: AuditContext,
  ): Promise<Warehouse> {
    await this.requireBranch(branchId);
    this.branchScope.assertBranchAccess(user, branchId);

    const duplicate = await this.prisma.warehouse.findUnique({
      where: { branchId_code: { branchId, code: dto.code } },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `A warehouse with code "${dto.code}" already exists in this branch.`,
      );
    }

    const warehouse = await this.prisma.warehouse.create({
      data: {
        branchId,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
      },
    });

    await this.audit.log({
      action: 'warehouse.created',
      resourceType: 'warehouse',
      resourceId: warehouse.id,
      branchId,
      newValues: { code: warehouse.code, name: warehouse.name },
      ...ctx,
    });
    return warehouse;
  }

  /** Direct fetch: out-of-scope records are 404 (no existence leak). */
  async getById(user: AuthUser, id: string): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse || !this.branchScope.canAccess(user, warehouse.branchId)) {
      throw AppException.notFound('Warehouse not found.');
    }
    return warehouse;
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateWarehouseDto,
    ctx: AuditContext,
  ): Promise<Warehouse> {
    const existing = await this.getById(user, id);

    await this.assertDefaultLocation(id, dto.defaultReceivingLocationId, 'defaultReceivingLocationId');
    await this.assertDefaultLocation(id, dto.defaultIssueLocationId, 'defaultIssueLocationId');

    const warehouse = await this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.defaultReceivingLocationId !== undefined
          ? { defaultReceivingLocationId: dto.defaultReceivingLocationId }
          : {}),
        ...(dto.defaultIssueLocationId !== undefined
          ? { defaultIssueLocationId: dto.defaultIssueLocationId }
          : {}),
      },
    });

    await this.audit.log({
      action: 'warehouse.updated',
      resourceType: 'warehouse',
      resourceId: id,
      branchId: warehouse.branchId,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(warehouse),
      ...ctx,
    });
    return warehouse;
  }

  private async requireBranch(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true },
    });
    if (!branch) {
      throw AppException.notFound('Branch not found.');
    }
  }

  /** A default location must belong to the warehouse it is a default for. */
  private async assertDefaultLocation(
    warehouseId: string,
    locationId: string | null | undefined,
    field: string,
  ): Promise<void> {
    if (locationId === undefined || locationId === null) {
      return;
    }
    const location = await this.prisma.storageLocation.findUnique({
      where: { id: locationId },
      select: { warehouseId: true },
    });
    if (!location || location.warehouseId !== warehouseId) {
      throw AppException.validation([
        {
          field,
          message: 'Location does not exist or belongs to another warehouse.',
        },
      ]);
    }
  }

  private snapshot(warehouse: Warehouse) {
    return {
      name: warehouse.name,
      description: warehouse.description,
      isActive: warehouse.isActive,
      defaultReceivingLocationId: warehouse.defaultReceivingLocationId,
      defaultIssueLocationId: warehouse.defaultIssueLocationId,
    };
  }
}
