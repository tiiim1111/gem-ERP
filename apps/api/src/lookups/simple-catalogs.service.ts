import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCodeNameDto,
  LookupQueryDto,
  UpdateCodeNameDto,
} from './dto/lookup-common.dto';

/** Positions, brands, and manufacturers share this exact record shape. */
export interface SimpleCatalogEntry {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Minimal structural view of the Prisma delegates for position / brand /
 * manufacturer — identical scalar fields, so one implementation serves all
 * three. The reference-count check (delete protection) is per-kind config.
 */
interface SimpleCatalogDelegate {
  findUnique(args: {
    where: { id: string } | { code: string };
  }): Promise<SimpleCatalogEntry | null>;
  findMany(args: {
    where: object;
    orderBy: object;
    skip: number;
    take: number;
  }): Promise<SimpleCatalogEntry[]>;
  count(args: { where: object }): Promise<number>;
  create(args: { data: { code: string; name: string } }): Promise<SimpleCatalogEntry>;
  update(args: {
    where: { id: string };
    data: { name?: string; isActive?: boolean };
  }): Promise<SimpleCatalogEntry>;
  delete(args: { where: { id: string } }): Promise<SimpleCatalogEntry>;
}

export type SimpleCatalogKind = 'position' | 'brand' | 'manufacturer';

const SORTABLE = { code: 'code', name: 'name', createdAt: 'createdAt' };

@Injectable()
export class SimpleCatalogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private delegate(kind: SimpleCatalogKind): SimpleCatalogDelegate {
    const delegates = {
      position: this.prisma.position,
      brand: this.prisma.brand,
      manufacturer: this.prisma.manufacturer,
    };
    return delegates[kind] as unknown as SimpleCatalogDelegate;
  }

  /** Delete protection: count of records referencing this catalog entry. */
  private async referenceCount(
    kind: SimpleCatalogKind,
    id: string,
  ): Promise<number> {
    switch (kind) {
      case 'position': {
        const row = await this.prisma.position.findUnique({
          where: { id },
          select: { _count: { select: { employees: true, approvalSteps: true } } },
        });
        return (row?._count.employees ?? 0) + (row?._count.approvalSteps ?? 0);
      }
      case 'brand': {
        const row = await this.prisma.brand.findUnique({
          where: { id },
          select: { _count: { select: { items: true } } },
        });
        return row?._count.items ?? 0;
      }
      case 'manufacturer': {
        const row = await this.prisma.manufacturer.findUnique({
          where: { id },
          select: { _count: { select: { items: true } } },
        });
        return row?._count.items ?? 0;
      }
    }
  }

  async list(
    kind: SimpleCatalogKind,
    query: LookupQueryDto,
  ): Promise<Paginated<SimpleCatalogEntry>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'code',
      direction: 'asc',
    });

    const where: Prisma.PositionWhereInput = {};
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { name: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const delegate = this.delegate(kind);
    const [rows, total] = await Promise.all([
      delegate.findMany({ where, orderBy, skip, take }),
      delegate.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async getById(
    kind: SimpleCatalogKind,
    id: string,
  ): Promise<SimpleCatalogEntry> {
    const entry = await this.delegate(kind).findUnique({ where: { id } });
    if (!entry) {
      throw AppException.notFound(`${this.label(kind)} not found.`);
    }
    return entry;
  }

  async create(
    kind: SimpleCatalogKind,
    dto: CreateCodeNameDto,
    ctx: AuditContext,
  ): Promise<SimpleCatalogEntry> {
    const duplicate = await this.delegate(kind).findUnique({
      where: { code: dto.code },
    });
    if (duplicate) {
      throw AppException.duplicateCode(
        `A ${this.label(kind).toLowerCase()} with code "${dto.code}" already exists.`,
      );
    }
    const entry = await this.delegate(kind).create({
      data: { code: dto.code, name: dto.name },
    });
    await this.audit.log({
      action: `${kind}.created`,
      resourceType: kind,
      resourceId: entry.id,
      newValues: { code: entry.code, name: entry.name },
      ...ctx,
    });
    return entry;
  }

  async update(
    kind: SimpleCatalogKind,
    id: string,
    dto: UpdateCodeNameDto,
    ctx: AuditContext,
  ): Promise<SimpleCatalogEntry> {
    const existing = await this.getById(kind, id);
    const entry = await this.delegate(kind).update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      action: `${kind}.updated`,
      resourceType: kind,
      resourceId: id,
      oldValues: { name: existing.name, isActive: existing.isActive },
      newValues: { name: entry.name, isActive: entry.isActive },
      ...ctx,
    });
    return entry;
  }

  /** Delete-protected once referenced (spec §10): 409 IN_USE. */
  async remove(
    kind: SimpleCatalogKind,
    id: string,
    ctx: AuditContext,
  ): Promise<void> {
    const existing = await this.getById(kind, id);
    const references = await this.referenceCount(kind, id);
    if (references > 0) {
      throw AppException.inUse(
        `This ${this.label(kind).toLowerCase()} is referenced by ${references} record(s). ` +
          'Deactivate it instead of deleting.',
      );
    }
    await this.delegate(kind).delete({ where: { id } });
    await this.audit.log({
      action: `${kind}.deleted`,
      resourceType: kind,
      resourceId: id,
      oldValues: { code: existing.code, name: existing.name },
      ...ctx,
    });
  }

  private label(kind: SimpleCatalogKind): string {
    return { position: 'Position', brand: 'Brand', manufacturer: 'Manufacturer' }[
      kind
    ];
  }
}
