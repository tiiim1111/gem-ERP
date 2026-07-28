import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { Prisma, UnitOfMeasure } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { LookupQueryDto } from './dto/lookup-common.dto';
import {
  CreateUomConversionDto,
  CreateUomDto,
  UpdateUomConversionDto,
  UpdateUomDto,
} from './dto/uom.dto';

const UOM_SORTABLE = { code: 'code', name: 'name', createdAt: 'createdAt' };

const CONVERSION_INCLUDE = {
  fromUom: { select: { id: true, code: true, name: true } },
  toUom: { select: { id: true, code: true, name: true } },
  item: { select: { id: true, sku: true, name: true } },
} satisfies Prisma.UomConversionInclude;

type ConversionRow = Prisma.UomConversionGetPayload<{
  include: typeof CONVERSION_INCLUDE;
}>;

@Injectable()
export class UomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------- UOMs

  async list(query: LookupQueryDto): Promise<Paginated<UnitOfMeasure>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, UOM_SORTABLE, {
      field: 'code',
      direction: 'asc',
    });
    const where: Prisma.UnitOfMeasureWhereInput = {};
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
      this.prisma.unitOfMeasure.findMany({ where, orderBy, skip, take }),
      this.prisma.unitOfMeasure.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async getById(id: string): Promise<UnitOfMeasure> {
    const uom = await this.prisma.unitOfMeasure.findUnique({ where: { id } });
    if (!uom) {
      throw AppException.notFound('Unit of measure not found.');
    }
    return uom;
  }

  async create(dto: CreateUomDto, ctx: AuditContext): Promise<UnitOfMeasure> {
    const duplicate = await this.prisma.unitOfMeasure.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `A unit of measure with code "${dto.code}" already exists.`,
      );
    }
    const uom = await this.prisma.unitOfMeasure.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
      },
    });
    await this.audit.log({
      action: 'uom.created',
      resourceType: 'uom',
      resourceId: uom.id,
      newValues: { code: uom.code, name: uom.name },
      ...ctx,
    });
    return uom;
  }

  async update(
    id: string,
    dto: UpdateUomDto,
    ctx: AuditContext,
  ): Promise<UnitOfMeasure> {
    const existing = await this.getById(id);
    const uom = await this.prisma.unitOfMeasure.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      action: 'uom.updated',
      resourceType: 'uom',
      resourceId: id,
      oldValues: {
        name: existing.name,
        description: existing.description,
        isActive: existing.isActive,
      },
      newValues: { name: uom.name, description: uom.description, isActive: uom.isActive },
      ...ctx,
    });
    return uom;
  }

  async remove(id: string, ctx: AuditContext): Promise<void> {
    const existing = await this.getById(id);
    const counts = await this.prisma.unitOfMeasure.findUnique({
      where: { id },
      include: { _count: true },
    });
    const references = Object.values(counts?._count ?? {}).reduce(
      (sum: number, count) => sum + (typeof count === 'number' ? count : 0),
      0,
    );
    if (references > 0) {
      throw AppException.inUse(
        `This unit of measure is referenced by ${references} record(s). Deactivate it instead of deleting.`,
      );
    }
    await this.prisma.unitOfMeasure.delete({ where: { id } });
    await this.audit.log({
      action: 'uom.deleted',
      resourceType: 'uom',
      resourceId: id,
      oldValues: { code: existing.code, name: existing.name },
      ...ctx,
    });
  }

  // ------------------------------------------------------------ conversions

  async listConversions(
    query: LookupQueryDto & { itemId?: string; global?: boolean },
  ): Promise<Paginated<ConversionRow>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const where: Prisma.UomConversionWhereInput = {};
    if (query.itemId) {
      where.itemId = query.itemId;
    } else if (query.global) {
      where.itemId = null;
    }

    const [rows, total] = await Promise.all([
      this.prisma.uomConversion.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
        include: CONVERSION_INCLUDE,
      }),
      this.prisma.uomConversion.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async createConversion(
    dto: CreateUomConversionDto,
    ctx: AuditContext,
  ): Promise<ConversionRow> {
    if (dto.fromUomId === dto.toUomId) {
      throw AppException.validation([
        { field: 'toUomId', message: 'fromUomId and toUomId must differ.' },
      ]);
    }
    for (const [field, uomId] of [
      ['fromUomId', dto.fromUomId],
      ['toUomId', dto.toUomId],
    ] as const) {
      const uom = await this.prisma.unitOfMeasure.findUnique({
        where: { id: uomId },
        select: { id: true },
      });
      if (!uom) {
        throw AppException.validation([
          { field, message: 'Unit of measure does not exist.' },
        ]);
      }
    }
    if (dto.itemId) {
      const item = await this.prisma.item.findUnique({
        where: { id: dto.itemId },
        select: { id: true },
      });
      if (!item) {
        throw AppException.validation([
          { field: 'itemId', message: 'Item does not exist.' },
        ]);
      }
    }

    const duplicate = await this.prisma.uomConversion.findFirst({
      where: {
        itemId: dto.itemId ?? null,
        fromUomId: dto.fromUomId,
        toUomId: dto.toUomId,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        'A conversion between these units already exists for this scope.',
      );
    }

    const conversion = await this.prisma.uomConversion.create({
      data: {
        itemId: dto.itemId ?? null,
        fromUomId: dto.fromUomId,
        toUomId: dto.toUomId,
        factor: dto.factor,
      },
      include: CONVERSION_INCLUDE,
    });
    await this.audit.log({
      action: 'uom_conversion.created',
      resourceType: 'uom_conversion',
      resourceId: conversion.id,
      newValues: this.conversionSnapshot(conversion),
      ...ctx,
    });
    return conversion;
  }

  async getConversion(id: string): Promise<ConversionRow> {
    const conversion = await this.prisma.uomConversion.findUnique({
      where: { id },
      include: CONVERSION_INCLUDE,
    });
    if (!conversion) {
      throw AppException.notFound('UOM conversion not found.');
    }
    return conversion;
  }

  async updateConversion(
    id: string,
    dto: UpdateUomConversionDto,
    ctx: AuditContext,
  ): Promise<ConversionRow> {
    const existing = await this.getConversion(id);
    const conversion = await this.prisma.uomConversion.update({
      where: { id },
      data: { factor: dto.factor },
      include: CONVERSION_INCLUDE,
    });
    await this.audit.log({
      action: 'uom_conversion.updated',
      resourceType: 'uom_conversion',
      resourceId: id,
      oldValues: this.conversionSnapshot(existing),
      newValues: this.conversionSnapshot(conversion),
      ...ctx,
    });
    return conversion;
  }

  async removeConversion(id: string, ctx: AuditContext): Promise<void> {
    const existing = await this.getConversion(id);
    await this.prisma.uomConversion.delete({ where: { id } });
    await this.audit.log({
      action: 'uom_conversion.deleted',
      resourceType: 'uom_conversion',
      resourceId: id,
      oldValues: this.conversionSnapshot(existing),
      ...ctx,
    });
  }

  private conversionSnapshot(conversion: ConversionRow) {
    return {
      itemId: conversion.itemId,
      fromUom: conversion.fromUom.code,
      toUom: conversion.toUom.code,
      factor: conversion.factor.toString(),
    };
  }
}
