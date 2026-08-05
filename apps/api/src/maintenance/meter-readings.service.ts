import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import {
  METER_READING_SELECT,
  MeterReadingView,
  toMeterReadingView,
} from './maintenance-views';
import {
  CreateMeterReadingDto,
  QueryMeterReadingsDto,
} from './dto/meter-reading.dto';

const SORTABLE = { readingAt: 'readingAt', createdAt: 'createdAt' };

/**
 * Asset usage-meter readings (api-outline 6.2: GET/POST
 * /assets/:id/meter-readings) — the history that drives meter-interval
 * maintenance plans. Readings are monotonic per (asset, meterType): a value
 * below the latest recorded one is rejected, because a shrinking meter would
 * corrupt meter-based dueness.
 */
@Injectable()
export class MeterReadingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthUser,
    assetId: string,
    query: QueryMeterReadingsDto,
  ): Promise<Paginated<MeterReadingView>> {
    await this.requireAsset(user, assetId);
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'readingAt',
      direction: 'desc',
    });

    const where: Prisma.AssetMeterReadingWhereInput = { assetId };
    if (query.meterType) {
      where.meterType = query.meterType;
    }
    if (query.from || query.to) {
      where.readingAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.assetMeterReading.findMany({
        where,
        orderBy,
        skip,
        take,
        select: METER_READING_SELECT,
      }),
      this.prisma.assetMeterReading.count({ where }),
    ]);
    return paginated(rows.map(toMeterReadingView), page, pageSize, total);
  }

  async create(
    user: AuthUser,
    assetId: string,
    dto: CreateMeterReadingDto,
    ctx: AuditContext,
  ): Promise<MeterReadingView> {
    const asset = await this.requireAsset(user, assetId);
    const readingValue = new Prisma.Decimal(dto.readingValue);
    const readingAt = dto.readingAt ? new Date(dto.readingAt) : new Date();
    const meterType = dto.meterType ?? null;

    const latest = await this.prisma.assetMeterReading.findFirst({
      where: { assetId, meterType },
      orderBy: { readingAt: 'desc' },
      select: { readingValue: true, readingAt: true },
    });
    if (latest && readingValue.lt(latest.readingValue)) {
      throw AppException.validation([
        {
          field: 'readingValue',
          message: `Reading ${readingValue.toString()} is below the latest recorded value ${latest.readingValue.toString()} — meters are monotonic per meter type.`,
        },
      ]);
    }

    const created = await this.prisma.assetMeterReading.create({
      data: {
        assetId,
        meterType,
        readingValue,
        readingAt,
        recordedById: user.id,
        notes: dto.notes ?? null,
      },
      select: METER_READING_SELECT,
    });

    await this.audit.log({
      action: 'asset.meter_reading_recorded',
      resourceType: 'asset',
      resourceId: assetId,
      branchId: asset.branchId,
      newValues: {
        meterType,
        readingValue: readingValue.toString(),
        readingAt: readingAt.toISOString(),
      },
      ...ctx,
    });
    return toMeterReadingView(created);
  }

  private async requireAsset(user: AuthUser, assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, branchId: true, archivedAt: true },
    });
    if (
      !asset ||
      asset.archivedAt ||
      !this.branchScope.canAccess(user, asset.branchId)
    ) {
      throw AppException.notFound('Asset not found.');
    }
    return asset;
  }
}
