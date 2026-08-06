import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Paginated } from '@gemerp/shared';
import {
  AssetLifecycleStatus,
  CountLineFlag,
  InventoryCountStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { ItemBarcodesService } from '../items/item-barcodes.service';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  countSessionSequenceKey,
  formatCountSessionNumber,
} from './count-numbers';
import {
  activeQuantityField,
  canCountTransition,
  classifyAssetLine,
  classifyQuantityLine,
  computeVarianceQuantity,
  countTransitionError,
  effectiveCountedQuantity,
  shouldMaskExpected,
} from './count-rules';
import {
  COUNT_LINE_SELECT,
  COUNT_SESSION_DETAIL_SELECT,
  COUNT_SESSION_LIST_SELECT,
  CountLineView,
  CountSessionDetailView,
  CountSessionView,
  toCountLineView,
  toCountSessionDetailView,
  toCountSessionView,
} from './count-views';
import {
  CancelCountSessionDto,
  CountScopeDto,
  CreateCountSessionDto,
  QueryCountSessionsDto,
  RecordCountDto,
  RecountDto,
  ScanCountDto,
  UpdateCountSessionDto,
} from './dto/count-session.dto';

const SORTABLE = {
  countNumber: 'countNumber',
  status: 'status',
  type: 'type',
  createdAt: 'createdAt',
  startedAt: 'startedAt',
};

/** Asset states physically expected inside a warehouse (snapshot scope). */
const COUNTABLE_ASSET_STATUSES: readonly AssetLifecycleStatus[] = [
  AssetLifecycleStatus.AVAILABLE,
  AssetLifecycleStatus.RESERVED,
  AssetLifecycleStatus.DAMAGED,
];

/**
 * Physical inventory & cycle counts (spec §17, api-outline 7.1).
 *
 * `start` snapshots expected balances (and expected asset locations) into
 * count lines inside ONE database transaction — SNAPSHOT ISOLATION: stock
 * that moves after the snapshot never touches the frozen expectedQuantity,
 * so variance math cannot be corrupted mid-count. Counts NEVER write
 * balances; approved variances become draft adjustment stock transactions
 * (CountAdjustmentsService) that flow through the ordinary approval +
 * posting machine.
 */
@Injectable()
export class CountSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly itemBarcodes: ItemBarcodesService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    user: AuthUser,
    query: QueryCountSessionsDto,
  ): Promise<Paginated<CountSessionView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });
    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }
    const where: Prisma.InventoryCountSessionWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.number
        ? { countNumber: { contains: query.number, mode: 'insensitive' } }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.inventoryCountSession.findMany({
        where,
        orderBy,
        skip,
        take,
        select: COUNT_SESSION_LIST_SELECT,
      }),
      this.prisma.inventoryCountSession.count({ where }),
    ]);
    return paginated(rows.map(toCountSessionView), page, pageSize, total);
  }

  async getById(user: AuthUser, id: string): Promise<CountSessionDetailView> {
    const row = await this.prisma.inventoryCountSession.findUnique({
      where: { id },
      select: COUNT_SESSION_DETAIL_SELECT,
    });
    if (!row || !this.branchScope.canAccess(user, row.branch.id)) {
      throw AppException.notFound('Count session not found.');
    }
    return toCountSessionDetailView(row);
  }

  // -------------------------------------------------------------------------
  // Create / update drafts
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreateCountSessionDto,
    ctx: AuditContext,
  ): Promise<CountSessionDetailView> {
    this.branchScope.assertBranchAccess(user, dto.scope.branchId);
    await this.validateScope(dto.scope);

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const year = now.getUTCFullYear();
      const sequence = await this.sequences.next(
        tx,
        countSessionSequenceKey(year),
      );
      return tx.inventoryCountSession.create({
        data: {
          countNumber: formatCountSessionNumber(year, sequence),
          type: dto.type,
          status: InventoryCountStatus.DRAFT,
          branchId: dto.scope.branchId,
          warehouseId: dto.scope.warehouseId ?? null,
          storageLocationId: dto.scope.locationId ?? null,
          categoryId: dto.scope.categoryId ?? null,
          scopeItemIds: dto.scope.itemIds ?? [],
          isBlind: dto.blind ?? false,
          notes: dto.notes ?? null,
          createdById: user.id,
        },
        select: { id: true, countNumber: true },
      });
    });

    await this.audit.log({
      action: 'count_session.created',
      resourceType: 'count_session',
      resourceId: created.id,
      branchId: dto.scope.branchId,
      newValues: {
        countNumber: created.countNumber,
        type: dto.type,
        blind: dto.blind ?? false,
        scope: dto.scope,
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateCountSessionDto,
    ctx: AuditContext,
  ): Promise<CountSessionDetailView> {
    const session = await this.requireSession(user, id);
    if (!canCountTransition(session.status, 'update')) {
      throw AppException.invalidStateTransition(
        countTransitionError(session.status, 'update'),
      );
    }
    if (dto.scope) {
      this.branchScope.assertBranchAccess(user, dto.scope.branchId);
      await this.validateScope(dto.scope);
    }

    const claimed = await this.prisma.inventoryCountSession.updateMany({
      where: { id, version: dto.version, status: InventoryCountStatus.DRAFT },
      data: {
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.blind !== undefined ? { isBlind: dto.blind } : {}),
        ...(dto.scope
          ? {
              branchId: dto.scope.branchId,
              warehouseId: dto.scope.warehouseId ?? null,
              storageLocationId: dto.scope.locationId ?? null,
              categoryId: dto.scope.categoryId ?? null,
              scopeItemIds: dto.scope.itemIds ?? [],
            }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.versionConflict();
    }
    await this.audit.log({
      action: 'count_session.updated',
      resourceType: 'count_session',
      resourceId: id,
      branchId: session.branchId,
      oldValues: { version: dto.version },
      newValues: { ...dto },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Start: atomic snapshot
  // -------------------------------------------------------------------------

  async start(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<CountSessionDetailView> {
    const session = await this.requireSession(user, id);
    if (!canCountTransition(session.status, 'start')) {
      throw AppException.invalidStateTransition(
        countTransitionError(session.status, 'start'),
      );
    }

    const now = new Date();
    const summary = await this.prisma.$transaction(async (tx) => {
      // Claim first — a concurrent start loses here and rolls back.
      const claimed = await tx.inventoryCountSession.updateMany({
        where: { id, status: InventoryCountStatus.DRAFT },
        data: {
          status: InventoryCountStatus.IN_PROGRESS,
          snapshotAt: now,
          startedAt: now,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.invalidStateTransition(
          'The count session was modified concurrently. Refetch and retry.',
        );
      }

      const warehouseIds = session.warehouseId
        ? [session.warehouseId]
        : (
            await tx.warehouse.findMany({
              where: { branchId: session.branchId, isActive: true },
              select: { id: true },
            })
          ).map((warehouse) => warehouse.id);
      if (warehouseIds.length === 0) {
        throw AppException.validation([
          {
            field: 'scope',
            message: 'The branch has no active warehouses to count.',
          },
        ]);
      }

      const itemScope: Prisma.ItemWhereInput = {
        ...(session.categoryId ? { categoryId: session.categoryId } : {}),
      };
      const itemIdFilter =
        session.scopeItemIds.length > 0
          ? { in: session.scopeItemIds }
          : undefined;

      // Expected balances — the frozen snapshot (one line per non-zero
      // balance bucket, in the item's base UOM).
      const balances = await tx.stockBalance.findMany({
        where: {
          warehouseId: { in: warehouseIds },
          ...(session.storageLocationId
            ? { storageLocationId: session.storageLocationId }
            : {}),
          ...(itemIdFilter ? { itemId: itemIdFilter } : {}),
          item: itemScope,
          onHandQty: { not: 0 },
        },
        select: {
          itemId: true,
          lotId: true,
          warehouseId: true,
          storageLocationId: true,
          onHandQty: true,
          item: { select: { baseUomId: true } },
        },
      });

      // Expected assets — existence/condition/location verification.
      const assets = await tx.asset.findMany({
        where: {
          branchId: session.branchId,
          warehouseId: { in: warehouseIds },
          ...(session.storageLocationId
            ? { storageLocationId: session.storageLocationId }
            : {}),
          ...(itemIdFilter ? { itemId: itemIdFilter } : {}),
          item: itemScope,
          status: { in: [...COUNTABLE_ASSET_STATUSES] },
          archivedAt: null,
        },
        select: {
          id: true,
          itemId: true,
          warehouseId: true,
          storageLocationId: true,
        },
      });

      if (balances.length === 0 && assets.length === 0) {
        throw AppException.validation([
          {
            field: 'scope',
            message:
              'The scope resolves to no stock balances or assets — nothing to count.',
          },
        ]);
      }

      await tx.inventoryCountLine.createMany({
        data: [
          ...balances.map((balance) => ({
            countSessionId: id,
            itemId: balance.itemId,
            lotId: balance.lotId,
            warehouseId: balance.warehouseId,
            storageLocationId: balance.storageLocationId,
            uomId: balance.item.baseUomId,
            expectedQuantity: balance.onHandQty,
          })),
          ...assets.map((asset) => ({
            countSessionId: id,
            itemId: asset.itemId,
            assetId: asset.id,
            warehouseId: asset.warehouseId,
            storageLocationId: asset.storageLocationId,
          })),
        ],
      });
      return { stockLines: balances.length, assetLines: assets.length };
    });

    await this.audit.log({
      action: 'count_session.started',
      resourceType: 'count_session',
      resourceId: id,
      branchId: session.branchId,
      oldValues: { status: session.status },
      newValues: {
        status: InventoryCountStatus.IN_PROGRESS,
        snapshotAt: now.toISOString(),
        ...summary,
      },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Record one line
  // -------------------------------------------------------------------------

  async recordLine(
    user: AuthUser,
    sessionId: string,
    lineId: string,
    dto: RecordCountDto,
    ctx: AuditContext,
  ): Promise<CountLineView> {
    const session = await this.requireSession(user, sessionId);
    if (!canCountTransition(session.status, 'record')) {
      throw AppException.invalidStateTransition(
        countTransitionError(session.status, 'record'),
      );
    }
    const line = await this.prisma.inventoryCountLine.findFirst({
      where: { id: lineId, countSessionId: sessionId },
      select: {
        id: true,
        itemId: true,
        assetId: true,
        countedQuantity: true,
        recountQuantity: true,
        recountRequested: true,
        assetFound: true,
        flag: true,
        notes: true,
      },
    });
    if (!line) {
      throw AppException.notFound('Count line not found.');
    }

    const now = new Date();
    let duplicate = false;
    let data: Prisma.InventoryCountLineUncheckedUpdateInput;
    if (line.assetId) {
      if (dto.found === undefined) {
        throw AppException.validation([
          {
            field: 'found',
            message: 'Asset lines record {found, conditionId?, locationConfirmed?}.',
          },
        ]);
      }
      if (dto.countedQty !== undefined) {
        throw AppException.validation([
          { field: 'countedQty', message: 'Asset lines have no quantity.' },
        ]);
      }
      if (dto.conditionId) {
        await this.requireCondition(dto.conditionId);
      }
      duplicate = line.assetFound !== null && !line.recountRequested;
      data = {
        assetFound: dto.found,
        locationConfirmed: dto.locationConfirmed ?? null,
        ...(dto.conditionId ? { conditionId: dto.conditionId } : {}),
        ...(duplicate ? { flag: CountLineFlag.DUPLICATE } : {}),
      };
    } else {
      if (dto.countedQty === undefined) {
        throw AppException.validation([
          { field: 'countedQty', message: 'Quantity lines require countedQty.' },
        ]);
      }
      if (dto.found !== undefined || dto.locationConfirmed !== undefined) {
        throw AppException.validation([
          {
            field: 'found',
            message: 'found/locationConfirmed apply to asset lines only.',
          },
        ]);
      }
      const field = activeQuantityField(line);
      duplicate = line[field] !== null;
      data = {
        [field]: new Prisma.Decimal(dto.countedQty),
        ...(duplicate && !line.recountRequested
          ? { flag: CountLineFlag.DUPLICATE }
          : {}),
      };
    }

    const updated = await this.prisma.inventoryCountLine.update({
      where: { id: lineId },
      data: {
        ...data,
        countedById: user.id,
        countedAt: now,
        ...(dto.notes
          ? { notes: line.notes ? `${line.notes}\n${dto.notes}` : dto.notes }
          : {}),
      },
      select: COUNT_LINE_SELECT,
    });

    await this.audit.log({
      action: 'count_session.line_recorded',
      resourceType: 'count_session',
      resourceId: sessionId,
      branchId: session.branchId,
      newValues: {
        lineId,
        ...(line.assetId
          ? {
              assetId: line.assetId,
              found: dto.found,
              locationConfirmed: dto.locationConfirmed ?? null,
            }
          : { countedQty: dto.countedQty }),
        duplicate,
      },
      ...ctx,
    });
    return toCountLineView(updated, shouldMaskExpected(session));
  }

  // -------------------------------------------------------------------------
  // Rapid scan entry
  // -------------------------------------------------------------------------

  async scan(
    user: AuthUser,
    sessionId: string,
    dto: ScanCountDto,
    ctx: AuditContext,
  ): Promise<CountLineView> {
    const session = await this.requireSession(user, sessionId);
    if (!canCountTransition(session.status, 'record')) {
      throw AppException.invalidStateTransition(
        countTransitionError(session.status, 'record'),
      );
    }
    const code = dto.code.trim();
    const qty = new Prisma.Decimal(dto.qty ?? '1');
    if (qty.lte(0)) {
      throw AppException.validation([
        { field: 'qty', message: 'qty must be greater than zero.' },
      ]);
    }

    // 1. Item / lot barcode families via the existing catalog resolver.
    let resolvedItem: { itemId: string; lotId: string | null } | null = null;
    try {
      const resolved = await this.itemBarcodes.resolve(user, code);
      if (resolved.type === 'item') {
        resolvedItem = { itemId: resolved.item.id, lotId: null };
      } else if (resolved.type === 'lot') {
        resolvedItem = { itemId: resolved.item.id, lotId: resolved.lot.id };
      } else {
        throw AppException.validation([
          {
            field: 'code',
            message:
              'The code resolves to a storage location — scan items or assets while counting.',
          },
        ]);
      }
    } catch (error) {
      if (!(error instanceof AppException) || error.getStatus() !== 404) {
        throw error;
      }
    }

    const now = new Date();
    if (resolvedItem) {
      const line = await this.upsertItemScanLine(
        user,
        session,
        resolvedItem,
        qty,
        dto,
        now,
      );
      await this.audit.log({
        action: 'count_session.scanned',
        resourceType: 'count_session',
        resourceId: sessionId,
        branchId: session.branchId,
        newValues: { code, kind: 'item', lineId: line.id, qty: qty.toString() },
        ...ctx,
      });
      return line;
    }

    // 2. Asset tag / manufacturer serial (branch-scoped).
    const asset = await this.prisma.asset.findFirst({
      where: {
        OR: [{ assetTag: code.toUpperCase() }, { serialNumber: code }],
        branchId: session.branchId,
        archivedAt: null,
      },
      select: {
        id: true,
        itemId: true,
        warehouseId: true,
        storageLocationId: true,
      },
    });
    if (!asset) {
      throw AppException.notFound('No item, lot, or asset matches this code.');
    }
    const line = await this.upsertAssetScanLine(user, session, asset, dto, now);
    await this.audit.log({
      action: 'count_session.scanned',
      resourceType: 'count_session',
      resourceId: sessionId,
      branchId: session.branchId,
      newValues: { code, kind: 'asset', lineId: line.id, assetId: asset.id },
      ...ctx,
    });
    return line;
  }

  private async upsertItemScanLine(
    user: AuthUser,
    session: SessionHead,
    resolved: { itemId: string; lotId: string | null },
    qty: Prisma.Decimal,
    dto: ScanCountDto,
    now: Date,
  ): Promise<CountLineView> {
    const mask = shouldMaskExpected(session);
    const candidates = await this.prisma.inventoryCountLine.findMany({
      where: {
        countSessionId: session.id,
        itemId: resolved.itemId,
        assetId: null,
        ...(resolved.lotId ? { lotId: resolved.lotId } : {}),
        ...(dto.locationId ? { storageLocationId: dto.locationId } : {}),
        ...(dto.warehouseId ? { warehouseId: dto.warehouseId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        countedQuantity: true,
        recountQuantity: true,
        recountRequested: true,
      },
    });
    // Prefer the first line still uncounted in its active pass; else the
    // first — scans ACCUMULATE (rapid counting), they never flag duplicates.
    const target =
      candidates.find((line) => line[activeQuantityField(line)] === null) ??
      candidates[0] ??
      null;

    if (target) {
      const field = activeQuantityField(target);
      const updated = await this.prisma.inventoryCountLine.update({
        where: { id: target.id },
        data: {
          [field]: (target[field] ?? new Prisma.Decimal(0)).add(qty),
          countedById: user.id,
          countedAt: now,
        },
        select: COUNT_LINE_SELECT,
      });
      return toCountLineView(updated, mask);
    }

    // Outside the snapshot → an UNEXPECTED find (expected 0).
    const warehouseId = dto.warehouseId ?? session.warehouseId;
    if (!warehouseId) {
      throw AppException.validation([
        {
          field: 'warehouseId',
          message:
            'This scan is outside the snapshot and the session spans multiple warehouses — pass warehouseId to place the unexpected find.',
        },
      ]);
    }
    const item = await this.prisma.item.findUnique({
      where: { id: resolved.itemId },
      select: { baseUomId: true },
    });
    const created = await this.prisma.inventoryCountLine.create({
      data: {
        countSessionId: session.id,
        itemId: resolved.itemId,
        lotId: resolved.lotId,
        warehouseId,
        storageLocationId: dto.locationId ?? null,
        uomId: item?.baseUomId ?? null,
        expectedQuantity: new Prisma.Decimal(0),
        countedQuantity: qty,
        flag: CountLineFlag.UNEXPECTED,
        countedById: user.id,
        countedAt: now,
      },
      select: COUNT_LINE_SELECT,
    });
    return toCountLineView(created, mask);
  }

  private async upsertAssetScanLine(
    user: AuthUser,
    session: SessionHead,
    asset: {
      id: string;
      itemId: string;
      warehouseId: string | null;
      storageLocationId: string | null;
    },
    dto: ScanCountDto,
    now: Date,
  ): Promise<CountLineView> {
    const mask = shouldMaskExpected(session);
    const existing = await this.prisma.inventoryCountLine.findFirst({
      where: { countSessionId: session.id, assetId: asset.id },
      select: {
        id: true,
        assetFound: true,
        recountRequested: true,
        storageLocationId: true,
      },
    });
    if (existing) {
      const duplicate = existing.assetFound !== null && !existing.recountRequested;
      const updated = await this.prisma.inventoryCountLine.update({
        where: { id: existing.id },
        data: {
          assetFound: true,
          // Scanning at the expected location confirms it; scanning while a
          // different location context is set flags a location mismatch.
          locationConfirmed: dto.locationId
            ? dto.locationId === existing.storageLocationId
            : true,
          ...(duplicate ? { flag: CountLineFlag.DUPLICATE } : {}),
          countedById: user.id,
          countedAt: now,
        },
        select: COUNT_LINE_SELECT,
      });
      return toCountLineView(updated, mask);
    }

    const warehouseId =
      dto.warehouseId ?? session.warehouseId ?? asset.warehouseId;
    const created = await this.prisma.inventoryCountLine.create({
      data: {
        countSessionId: session.id,
        itemId: asset.itemId,
        assetId: asset.id,
        warehouseId,
        storageLocationId: dto.locationId ?? asset.storageLocationId,
        assetFound: true,
        locationConfirmed: null,
        flag: CountLineFlag.UNEXPECTED,
        countedById: user.id,
        countedAt: now,
      },
      select: COUNT_LINE_SELECT,
    });
    return toCountLineView(created, mask);
  }

  // -------------------------------------------------------------------------
  // Recount / variance / complete / cancel
  // -------------------------------------------------------------------------

  async recount(
    user: AuthUser,
    id: string,
    dto: RecountDto,
    ctx: AuditContext,
  ): Promise<CountSessionDetailView> {
    const session = await this.requireSession(user, id);
    if (!canCountTransition(session.status, 'recount')) {
      throw AppException.invalidStateTransition(
        countTransitionError(session.status, 'recount'),
      );
    }
    const lines = await this.prisma.inventoryCountLine.findMany({
      where: { id: { in: dto.lineIds }, countSessionId: id },
      select: { id: true, assetId: true },
    });
    if (lines.length !== dto.lineIds.length) {
      throw AppException.validation([
        {
          field: 'lineIds',
          message: 'One or more lines do not belong to this session.',
        },
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      const assetLineIds = lines
        .filter((line) => line.assetId)
        .map((line) => line.id);
      const qtyLineIds = lines
        .filter((line) => !line.assetId)
        .map((line) => line.id);
      if (qtyLineIds.length > 0) {
        await tx.inventoryCountLine.updateMany({
          where: { id: { in: qtyLineIds } },
          data: {
            recountRequested: true,
            recountQuantity: null,
            varianceQuantity: null,
            flag: null,
          },
        });
      }
      if (assetLineIds.length > 0) {
        // Asset recount = full re-verification.
        await tx.inventoryCountLine.updateMany({
          where: { id: { in: assetLineIds } },
          data: {
            recountRequested: true,
            assetFound: null,
            locationConfirmed: null,
            varianceQuantity: null,
            flag: null,
          },
        });
      }
      if (session.status === InventoryCountStatus.REVIEW) {
        // Reopening locked lines reopens the session for counting.
        const claimed = await tx.inventoryCountSession.updateMany({
          where: { id, status: InventoryCountStatus.REVIEW },
          data: {
            status: InventoryCountStatus.IN_PROGRESS,
            completedAt: null,
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The count session was modified concurrently. Refetch and retry.',
          );
        }
      }
    });

    await this.audit.log({
      action: 'count_session.recount_requested',
      resourceType: 'count_session',
      resourceId: id,
      branchId: session.branchId,
      newValues: {
        lineIds: dto.lineIds,
        reopenedFromReview: session.status === InventoryCountStatus.REVIEW,
      },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async variance(user: AuthUser, id: string): Promise<{
    session: CountSessionView;
    summary: Record<string, number | string>;
    lines: CountLineView[];
  }> {
    const row = await this.prisma.inventoryCountSession.findUnique({
      where: { id },
      select: COUNT_SESSION_DETAIL_SELECT,
    });
    if (!row || !this.branchScope.canAccess(user, row.branch.id)) {
      throw AppException.notFound('Count session not found.');
    }
    const mask = shouldMaskExpected(row);
    const lines = row.lines.map((line) => toCountLineView(line, mask));

    let positive = new Prisma.Decimal(0);
    let negative = new Prisma.Decimal(0);
    let counted = 0;
    const flagTotals: Record<string, number> = {};
    for (const line of row.lines) {
      if (line.assetId) {
        if (line.assetFound !== null) counted += 1;
      } else if (effectiveCountedQuantity(line) !== null) {
        counted += 1;
      }
      if (!line.assetId && !mask) {
        const variance = line.varianceQuantity ?? computeVarianceQuantity(line);
        if (variance.gt(0)) positive = positive.add(variance);
        if (variance.lt(0)) negative = negative.add(variance);
      }
      const flag =
        line.flag ??
        (line.assetId
          ? null
          : mask
            ? null
            : classifyQuantityLine(line));
      if (flag) {
        flagTotals[flag] = (flagTotals[flag] ?? 0) + 1;
      }
    }
    return {
      session: toCountSessionView(row),
      summary: {
        totalLines: row.lines.length,
        countedLines: counted,
        uncountedLines: row.lines.length - counted,
        ...(mask
          ? {}
          : {
              positiveVariance: positive.toString(),
              negativeVariance: negative.toString(),
            }),
        ...flagTotals,
      },
      lines,
    };
  }

  /**
   * Close counting (count.approve): IN_PROGRESS → REVIEW. Locks the lines
   * and freezes per-line variance + flags computed from the SNAPSHOT
   * expectations — never from live balances.
   */
  async complete(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<CountSessionDetailView> {
    const session = await this.requireSession(user, id);
    if (!canCountTransition(session.status, 'complete')) {
      throw AppException.invalidStateTransition(
        countTransitionError(session.status, 'complete'),
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inventoryCountSession.updateMany({
        where: { id, status: InventoryCountStatus.IN_PROGRESS },
        data: {
          status: InventoryCountStatus.REVIEW,
          completedAt: now,
          approvedById: user.id,
          approvedAt: now,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.invalidStateTransition(
          'The count session was modified concurrently. Refetch and retry.',
        );
      }
      const lines = await tx.inventoryCountLine.findMany({
        where: { countSessionId: id },
        select: {
          id: true,
          assetId: true,
          expectedQuantity: true,
          countedQuantity: true,
          recountQuantity: true,
          assetFound: true,
          locationConfirmed: true,
          flag: true,
        },
      });
      for (const line of lines) {
        if (line.assetId) {
          await tx.inventoryCountLine.update({
            where: { id: line.id },
            data: { flag: classifyAssetLine(line), varianceQuantity: null },
          });
        } else {
          await tx.inventoryCountLine.update({
            where: { id: line.id },
            data: {
              varianceQuantity: computeVarianceQuantity(line),
              flag: classifyQuantityLine(line),
            },
          });
        }
      }
    });

    await this.audit.log({
      action: 'count_session.completed',
      resourceType: 'count_session',
      resourceId: id,
      branchId: session.branchId,
      oldValues: { status: session.status },
      newValues: { status: InventoryCountStatus.REVIEW },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelCountSessionDto,
    ctx: AuditContext,
  ): Promise<CountSessionDetailView> {
    const session = await this.requireSession(user, id);
    if (!canCountTransition(session.status, 'cancel')) {
      throw AppException.invalidStateTransition(
        countTransitionError(session.status, 'cancel'),
      );
    }
    const claimed = await this.prisma.inventoryCountSession.updateMany({
      where: { id, status: session.status },
      data: {
        status: InventoryCountStatus.CANCELED,
        cancelReason: dto.reason,
        canceledById: user.id,
        canceledAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The count session was modified concurrently. Refetch and retry.',
      );
    }
    await this.audit.log({
      action: 'count_session.canceled',
      resourceType: 'count_session',
      resourceId: id,
      branchId: session.branchId,
      oldValues: { status: session.status },
      newValues: { status: InventoryCountStatus.CANCELED },
      reason: dto.reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Shared helpers (also used by CountAdjustmentsService)
  // -------------------------------------------------------------------------

  async requireSession(user: AuthUser, id: string): Promise<SessionHead> {
    const session = await this.prisma.inventoryCountSession.findUnique({
      where: { id },
      select: {
        id: true,
        countNumber: true,
        status: true,
        type: true,
        isBlind: true,
        branchId: true,
        warehouseId: true,
        storageLocationId: true,
        categoryId: true,
        scopeItemIds: true,
        adjustmentIdempotencyKey: true,
        notes: true,
        createdById: true,
      },
    });
    if (!session || !this.branchScope.canAccess(user, session.branchId)) {
      throw AppException.notFound('Count session not found.');
    }
    return session;
  }

  private async validateScope(scope: CountScopeDto): Promise<void> {
    const errors: ApiErrorDetail[] = [];
    if (scope.warehouseId) {
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: scope.warehouseId },
        select: { id: true, branchId: true, isActive: true },
      });
      if (!warehouse || !warehouse.isActive) {
        errors.push({
          field: 'scope.warehouseId',
          message: 'Warehouse does not exist or is inactive.',
        });
      } else if (warehouse.branchId !== scope.branchId) {
        errors.push({
          field: 'scope.warehouseId',
          message: 'Warehouse belongs to a different branch.',
        });
      }
    }
    if (scope.locationId) {
      if (!scope.warehouseId) {
        errors.push({
          field: 'scope.locationId',
          message: 'locationId requires warehouseId.',
        });
      } else {
        const location = await this.prisma.storageLocation.findUnique({
          where: { id: scope.locationId },
          select: { id: true, warehouseId: true, isActive: true },
        });
        if (!location || !location.isActive) {
          errors.push({
            field: 'scope.locationId',
            message: 'Storage location does not exist or is inactive.',
          });
        } else if (location.warehouseId !== scope.warehouseId) {
          errors.push({
            field: 'scope.locationId',
            message: 'Storage location belongs to a different warehouse.',
          });
        }
      }
    }
    if (scope.categoryId) {
      const category = await this.prisma.itemCategory.findUnique({
        where: { id: scope.categoryId },
        select: { id: true },
      });
      if (!category) {
        errors.push({
          field: 'scope.categoryId',
          message: 'Item category does not exist.',
        });
      }
    }
    if (scope.itemIds && scope.itemIds.length > 0) {
      const found = await this.prisma.item.count({
        where: { id: { in: scope.itemIds } },
      });
      if (found !== scope.itemIds.length) {
        errors.push({
          field: 'scope.itemIds',
          message: 'One or more items do not exist.',
        });
      }
    }
    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
  }

  private async requireCondition(conditionId: string): Promise<void> {
    const condition = await this.prisma.lookupValue.findFirst({
      where: { id: conditionId, category: 'ASSET_CONDITION', isActive: true },
      select: { id: true },
    });
    if (!condition) {
      throw AppException.validation([
        {
          field: 'conditionId',
          message: 'conditionId must be an active ASSET_CONDITION lookup value.',
        },
      ]);
    }
  }
}

export interface SessionHead {
  id: string;
  countNumber: string;
  status: InventoryCountStatus;
  type: string;
  isBlind: boolean;
  branchId: string;
  warehouseId: string | null;
  storageLocationId: string | null;
  categoryId: string | null;
  scopeItemIds: string[];
  adjustmentIdempotencyKey: string | null;
  notes: string | null;
  createdById: string;
}
