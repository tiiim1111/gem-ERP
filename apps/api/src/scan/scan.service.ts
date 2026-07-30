import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { ItemBarcodesService } from '../items/item-barcodes.service';
import { extractScanToken } from '../assets/asset-tag.util';
import {
  permittedActions,
  type AssetEvent,
} from '../assets/asset-status-machine';

const SCAN_ASSET_SELECT = {
  id: true,
  assetTag: true,
  serialNumber: true,
  status: true,
  branchId: true,
  item: { select: { id: true, sku: true, name: true, model: true } },
  branch: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  storageLocation: { select: { id: true, code: true, name: true } },
  condition: { select: { id: true, code: true, name: true } },
  custodian: {
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
} satisfies Prisma.AssetSelect;

type ScanAssetRow = Prisma.AssetGetPayload<{ select: typeof SCAN_ASSET_SELECT }>;

export interface ScanAssetResult {
  kind: 'asset';
  id: string;
  summary: Omit<ScanAssetRow, 'branchId'>;
  /** Lifecycle actions the caller may fire — the API re-validates on use. */
  permittedActions: AssetEvent[];
}

export interface ScanOtherResult {
  kind: 'item' | 'lot' | 'location';
  id: string;
  summary: Record<string, unknown>;
}

export type ScanResult = ScanAssetResult | ScanOtherResult;

/**
 * Scan resolution (api-outline 4.4, docs/barcode-strategy.md §4, §6.3).
 *
 * Codes are opaque to security: resolution always re-checks permission and
 * branch scope on the resolved record. Unknown tokens and out-of-scope assets
 * answer identically (404 SCAN_TOKEN_NOT_FOUND) so the endpoint cannot be
 * used as an oracle for probing valid tokens.
 */
@Injectable()
export class ScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly itemBarcodes: ItemBarcodesService,
  ) {}

  /** GET /scan/:token — Phase 3 resolves asset tokens only. */
  async resolveToken(
    user: AuthUser,
    token: string,
    ctx: AuditContext,
  ): Promise<ScanAssetResult> {
    // Malformed tokens take the identical unknown-token path.
    const asset = /^[A-Za-z0-9_-]{20,128}$/.test(token)
      ? await this.prisma.asset.findUnique({
          where: { scanToken: token },
          select: SCAN_ASSET_SELECT,
        })
      : null;
    if (!asset || !this.branchScope.canAccess(user, asset.branchId)) {
      throw new AppException(
        404,
        'SCAN_TOKEN_NOT_FOUND',
        'This code does not resolve to anything you can access.',
      );
    }

    const result = this.toAssetResult(asset, user);
    await this.audit.log({
      action: 'scan.resolved',
      resourceType: 'asset',
      resourceId: asset.id,
      branchId: asset.branchId,
      metadata: { input: 'token', assetTag: asset.assetTag },
      ...ctx,
    });
    return result;
  }

  /**
   * POST /scan/resolve — raw scanner/keyboard input, resolution order per
   * docs/barcode-strategy.md §6.3: scan URL → asset tag → item/lot/bin
   * families (delegated to the catalog resolver) → manufacturer serial.
   */
  async resolveCode(
    user: AuthUser,
    code: string,
    ctx: AuditContext,
  ): Promise<ScanResult> {
    const trimmed = code.trim();
    const token = extractScanToken(trimmed);
    if (token) {
      return this.resolveToken(user, token, ctx);
    }

    if (trimmed.toUpperCase().startsWith('AST-')) {
      const asset = await this.prisma.asset.findUnique({
        where: { assetTag: trimmed.toUpperCase() },
        select: SCAN_ASSET_SELECT,
      });
      if (asset) {
        return this.assetIfPermitted(user, asset, ctx, 'tag');
      }
    }

    // LOT- / BIN- / SKU- / alternate barcode families.
    try {
      const resolved = await this.itemBarcodes.resolve(user, trimmed);
      if (resolved.type === 'item') {
        this.requirePermission(user, PERMISSIONS.item.view);
        const result: ScanOtherResult = {
          kind: 'item',
          id: resolved.item.id,
          summary: { item: resolved.item, mapping: resolved.mapping },
        };
        await this.logResolution(user, ctx, 'item', resolved.item.id);
        return result;
      }
      if (resolved.type === 'lot') {
        this.requirePermission(user, PERMISSIONS.item.view);
        const result: ScanOtherResult = {
          kind: 'lot',
          id: resolved.lot.id,
          summary: { lot: resolved.lot, item: resolved.item },
        };
        await this.logResolution(user, ctx, 'lot', resolved.lot.id);
        return result;
      }
      this.requirePermission(user, PERMISSIONS.storageLocation.view);
      const result: ScanOtherResult = {
        kind: 'location',
        id: resolved.storageLocation.id,
        summary: { storageLocation: resolved.storageLocation },
      };
      await this.logResolution(
        user,
        ctx,
        'location',
        resolved.storageLocation.id,
      );
      return result;
    } catch (error) {
      if (!(error instanceof AppException) || error.getStatus() !== 404) {
        throw error;
      }
    }

    // Manufacturer serial fallback (exact match, branch-scoped).
    const bySerial = await this.prisma.asset.findFirst({
      where: { serialNumber: trimmed },
      select: SCAN_ASSET_SELECT,
    });
    if (bySerial) {
      return this.assetIfPermitted(user, bySerial, ctx, 'serial');
    }

    throw AppException.notFound('No record matches this code.');
  }

  private async assetIfPermitted(
    user: AuthUser,
    asset: ScanAssetRow,
    ctx: AuditContext,
    input: string,
  ): Promise<ScanAssetResult> {
    this.requirePermission(user, PERMISSIONS.asset.view);
    if (!this.branchScope.canAccess(user, asset.branchId)) {
      // Out-of-scope behaves exactly like an unknown code (no leak).
      throw AppException.notFound('No record matches this code.');
    }
    const result = this.toAssetResult(asset, user);
    await this.audit.log({
      action: 'scan.resolved',
      resourceType: 'asset',
      resourceId: asset.id,
      branchId: asset.branchId,
      metadata: { input, assetTag: asset.assetTag },
      ...ctx,
    });
    return result;
  }

  private toAssetResult(asset: ScanAssetRow, user: AuthUser): ScanAssetResult {
    const { branchId: _branchId, ...summary } = asset;
    return {
      kind: 'asset',
      id: asset.id,
      summary,
      permittedActions: permittedActions(asset.status, user),
    };
  }

  private requirePermission(user: AuthUser, permission: string): void {
    if (!user.isSuperAdmin && !user.permissions.includes(permission)) {
      throw AppException.forbidden(
        'You do not have permission to view this kind of record.',
      );
    }
  }

  private async logResolution(
    user: AuthUser,
    ctx: AuditContext,
    kind: string,
    resourceId: string,
  ): Promise<void> {
    await this.audit.log({
      action: 'scan.resolved',
      resourceType: kind,
      resourceId,
      metadata: { input: 'code' },
      ...ctx,
    });
  }
}
