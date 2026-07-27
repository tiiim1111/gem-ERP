import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { Branch, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { OrgQueryDto } from './dto/org-query.dto';

const SORTABLE = {
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
  isActive: 'isActive',
};

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: OrgQueryDto): Promise<Paginated<Branch>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'code',
      direction: 'asc',
    });

    const where: Prisma.BranchWhereInput = {};
    const idFilter = this.branchScope.branchFilter(user);
    if (idFilter) {
      where.id = idFilter;
    }
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
      this.prisma.branch.findMany({ where, orderBy, skip, take }),
      this.prisma.branch.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  /** Out-of-scope direct fetches are 404 — existence is never leaked. */
  async getById(user: AuthUser, id: string): Promise<Branch> {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch || !this.branchScope.canAccess(user, branch.id)) {
      throw AppException.notFound('Branch not found.');
    }
    return branch;
  }

  async create(dto: CreateBranchDto, ctx: AuditContext): Promise<Branch> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!organization) {
      throw new AppException(
        409,
        'ORGANIZATION_NOT_CONFIGURED',
        'No organization exists yet. Seed or create the organization first.',
      );
    }

    const duplicate = await this.prisma.branch.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `A branch with code "${dto.code}" already exists.`,
      );
    }

    const branch = await this.prisma.branch.create({
      data: {
        organizationId: organization.id,
        code: dto.code,
        name: dto.name,
        address: dto.address ?? null,
        city: dto.city ?? null,
        region: dto.region ?? null,
        phone: dto.phone ?? null,
        timezone: dto.timezone ?? null,
      },
    });

    await this.audit.log({
      action: 'branch.created',
      resourceType: 'branch',
      resourceId: branch.id,
      branchId: branch.id,
      newValues: { code: branch.code, name: branch.name },
      ...ctx,
    });
    return branch;
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateBranchDto,
    ctx: AuditContext,
  ): Promise<Branch> {
    const existing = await this.getById(user, id);

    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.region !== undefined ? { region: dto.region } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      },
    });

    await this.audit.log({
      action: 'branch.updated',
      resourceType: 'branch',
      resourceId: id,
      branchId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(branch),
      ...ctx,
    });
    return branch;
  }

  async setActive(
    user: AuthUser,
    id: string,
    isActive: boolean,
    ctx: AuditContext,
  ): Promise<Branch> {
    const existing = await this.getById(user, id);
    const branch = await this.prisma.branch.update({
      where: { id },
      data: { isActive },
    });
    await this.audit.log({
      action: isActive ? 'branch.activated' : 'branch.deactivated',
      resourceType: 'branch',
      resourceId: id,
      branchId: id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive },
      ...ctx,
    });
    return branch;
  }

  private snapshot(branch: Branch) {
    return {
      name: branch.name,
      address: branch.address,
      city: branch.city,
      region: branch.region,
      phone: branch.phone,
      timezone: branch.timezone,
    };
  }
}
