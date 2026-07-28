import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { LookupValue, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLookupValueDto,
  LookupQueryDto,
  UpdateLookupValueDto,
} from './dto/lookup-common.dto';
import { categoryForLookupType } from './lookup-types';

const SORTABLE = {
  sortOrder: 'sortOrder',
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
};

/** Generic business-managed lookup values (spec §10) served per :type. */
@Injectable()
export class LookupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    type: string,
    query: LookupQueryDto,
  ): Promise<Paginated<LookupValue>> {
    const category = categoryForLookupType(type);
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'sortOrder',
      direction: 'asc',
    });

    const where: Prisma.LookupValueWhereInput = { category };
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
      this.prisma.lookupValue.findMany({
        where,
        orderBy: [orderBy, { code: 'asc' }],
        skip,
        take,
      }),
      this.prisma.lookupValue.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async create(
    type: string,
    dto: CreateLookupValueDto,
    ctx: AuditContext,
  ): Promise<LookupValue> {
    const category = categoryForLookupType(type);

    if (dto.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
        select: { id: true },
      });
      if (!branch) {
        throw AppException.validation([
          { field: 'branchId', message: 'Branch does not exist.' },
        ]);
      }
    }
    const duplicate = await this.prisma.lookupValue.findUnique({
      where: { category_code: { category, code: dto.code } },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `A ${type} value with code "${dto.code}" already exists.`,
      );
    }

    const value = await this.prisma.lookupValue.create({
      data: {
        category,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 0,
        branchId: dto.branchId ?? null,
      },
    });
    await this.audit.log({
      action: 'lookup.created',
      resourceType: 'lookup_value',
      resourceId: value.id,
      branchId: value.branchId ?? undefined,
      newValues: { category, code: value.code, name: value.name },
      ...ctx,
    });
    return value;
  }

  async update(
    type: string,
    id: string,
    dto: UpdateLookupValueDto,
    ctx: AuditContext,
  ): Promise<LookupValue> {
    const existing = await this.requireValue(type, id);

    const value = await this.prisma.lookupValue.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      action: 'lookup.updated',
      resourceType: 'lookup_value',
      resourceId: id,
      branchId: value.branchId ?? undefined,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(value),
      ...ctx,
    });
    return value;
  }

  /**
   * Hard delete is only allowed while the value is completely unreferenced;
   * referenced values must be deactivated instead (spec §10 delete protection).
   */
  async remove(type: string, id: string, ctx: AuditContext): Promise<void> {
    const existing = await this.requireValue(type, id);
    if (existing.isSystem) {
      throw AppException.inUse(
        'System lookup values cannot be deleted. Deactivate instead.',
      );
    }

    const withCounts = await this.prisma.lookupValue.findUnique({
      where: { id },
      include: { _count: true },
    });
    const references = Object.values(withCounts?._count ?? {}).reduce(
      (sum: number, count) => sum + (typeof count === 'number' ? count : 0),
      0,
    );
    if (references > 0) {
      throw AppException.inUse(
        `This value is referenced by ${references} record(s). Deactivate it instead of deleting.`,
      );
    }

    await this.prisma.lookupValue.delete({ where: { id } });
    await this.audit.log({
      action: 'lookup.deleted',
      resourceType: 'lookup_value',
      resourceId: id,
      branchId: existing.branchId ?? undefined,
      oldValues: this.snapshot(existing),
      ...ctx,
    });
  }

  private async requireValue(type: string, id: string): Promise<LookupValue> {
    const category = categoryForLookupType(type);
    const value = await this.prisma.lookupValue.findUnique({ where: { id } });
    if (!value || value.category !== category) {
      throw AppException.notFound('Lookup value not found.');
    }
    return value;
  }

  private snapshot(value: LookupValue) {
    return {
      category: value.category,
      code: value.code,
      name: value.name,
      description: value.description,
      sortOrder: value.sortOrder,
      isActive: value.isActive,
      branchId: value.branchId,
    };
  }
}
