import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { ItemCategory, ItemSubcategory, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateItemCategoryDto,
  UpdateItemCategoryDto,
} from './dto/item-category.dto';
import { LookupQueryDto } from './dto/lookup-common.dto';

const SORTABLE = {
  sortOrder: 'sortOrder',
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
};

@Injectable()
export class ItemCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- categories

  async list(query: LookupQueryDto): Promise<Paginated<ItemCategory>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'sortOrder',
      direction: 'asc',
    });
    const where: Prisma.ItemCategoryWhereInput = {};
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
      this.prisma.itemCategory.findMany({
        where,
        orderBy: [orderBy, { code: 'asc' }],
        skip,
        take,
      }),
      this.prisma.itemCategory.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async getById(id: string) {
    const category = await this.prisma.itemCategory.findUnique({
      where: { id },
      include: {
        subcategories: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] },
      },
    });
    if (!category) {
      throw AppException.notFound('Item category not found.');
    }
    return category;
  }

  async create(
    dto: CreateItemCategoryDto,
    ctx: AuditContext,
  ): Promise<ItemCategory> {
    const duplicate = await this.prisma.itemCategory.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `An item category with code "${dto.code}" already exists.`,
      );
    }
    const category = await this.prisma.itemCategory.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.log({
      action: 'item_category.created',
      resourceType: 'item_category',
      resourceId: category.id,
      newValues: { code: category.code, name: category.name },
      ...ctx,
    });
    return category;
  }

  async update(
    id: string,
    dto: UpdateItemCategoryDto,
    ctx: AuditContext,
  ): Promise<ItemCategory> {
    const existing = await this.requireCategory(id);
    const category = await this.prisma.itemCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      action: 'item_category.updated',
      resourceType: 'item_category',
      resourceId: id,
      oldValues: this.categorySnapshot(existing),
      newValues: this.categorySnapshot(category),
      ...ctx,
    });
    return category;
  }

  async remove(id: string, ctx: AuditContext): Promise<void> {
    const existing = await this.requireCategory(id);
    const counts = await this.prisma.itemCategory.findUnique({
      where: { id },
      select: {
        _count: {
          select: { items: true, subcategories: true, countSessions: true },
        },
      },
    });
    const references = Object.values(counts?._count ?? {}).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (references > 0) {
      throw AppException.inUse(
        `This category is referenced by ${references} record(s). Deactivate it instead of deleting.`,
      );
    }
    await this.prisma.itemCategory.delete({ where: { id } });
    await this.audit.log({
      action: 'item_category.deleted',
      resourceType: 'item_category',
      resourceId: id,
      oldValues: this.categorySnapshot(existing),
      ...ctx,
    });
  }

  // ---------------------------------------------------------- subcategories

  async listSubcategories(
    categoryId: string,
    query: LookupQueryDto,
  ): Promise<Paginated<ItemSubcategory>> {
    await this.requireCategory(categoryId);
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'sortOrder',
      direction: 'asc',
    });
    const where: Prisma.ItemSubcategoryWhereInput = { categoryId };
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
      this.prisma.itemSubcategory.findMany({
        where,
        orderBy: [orderBy, { code: 'asc' }],
        skip,
        take,
      }),
      this.prisma.itemSubcategory.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async createSubcategory(
    categoryId: string,
    dto: CreateItemCategoryDto,
    ctx: AuditContext,
  ): Promise<ItemSubcategory> {
    await this.requireCategory(categoryId);
    const duplicate = await this.prisma.itemSubcategory.findUnique({
      where: { categoryId_code: { categoryId, code: dto.code } },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `A subcategory with code "${dto.code}" already exists in this category.`,
      );
    }
    const subcategory = await this.prisma.itemSubcategory.create({
      data: {
        categoryId,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.log({
      action: 'item_subcategory.created',
      resourceType: 'item_subcategory',
      resourceId: subcategory.id,
      newValues: { categoryId, code: subcategory.code, name: subcategory.name },
      ...ctx,
    });
    return subcategory;
  }

  async getSubcategory(id: string): Promise<ItemSubcategory> {
    const subcategory = await this.prisma.itemSubcategory.findUnique({
      where: { id },
    });
    if (!subcategory) {
      throw AppException.notFound('Item subcategory not found.');
    }
    return subcategory;
  }

  async updateSubcategory(
    id: string,
    dto: UpdateItemCategoryDto,
    ctx: AuditContext,
  ): Promise<ItemSubcategory> {
    const existing = await this.getSubcategory(id);
    const subcategory = await this.prisma.itemSubcategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      action: 'item_subcategory.updated',
      resourceType: 'item_subcategory',
      resourceId: id,
      oldValues: this.subcategorySnapshot(existing),
      newValues: this.subcategorySnapshot(subcategory),
      ...ctx,
    });
    return subcategory;
  }

  async removeSubcategory(id: string, ctx: AuditContext): Promise<void> {
    const existing = await this.getSubcategory(id);
    const counts = await this.prisma.itemSubcategory.findUnique({
      where: { id },
      select: { _count: { select: { items: true } } },
    });
    if ((counts?._count.items ?? 0) > 0) {
      throw AppException.inUse(
        `This subcategory is referenced by ${counts?._count.items} item(s). Deactivate it instead of deleting.`,
      );
    }
    await this.prisma.itemSubcategory.delete({ where: { id } });
    await this.audit.log({
      action: 'item_subcategory.deleted',
      resourceType: 'item_subcategory',
      resourceId: id,
      oldValues: this.subcategorySnapshot(existing),
      ...ctx,
    });
  }

  // ----------------------------------------------------------------- shared

  private async requireCategory(id: string): Promise<ItemCategory> {
    const category = await this.prisma.itemCategory.findUnique({ where: { id } });
    if (!category) {
      throw AppException.notFound('Item category not found.');
    }
    return category;
  }

  private categorySnapshot(category: ItemCategory) {
    return {
      code: category.code,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    };
  }

  private subcategorySnapshot(subcategory: ItemSubcategory) {
    return {
      categoryId: subcategory.categoryId,
      code: subcategory.code,
      name: subcategory.name,
      description: subcategory.description,
      sortOrder: subcategory.sortOrder,
      isActive: subcategory.isActive,
    };
  }
}
