import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import type { BatchLabelsDto, LabelFormat, LabelSize } from './dto/label.dto';
import {
  buildScanUrl,
  renderBatchHtml,
  renderLabelPng,
  renderLabelSvg,
  type LabelData,
} from './label-render';

export interface RenderedLabel {
  contentType: string;
  body: Buffer | string;
  filename: string;
}

/**
 * Label generation (docs/barcode-strategy.md §2.2, §8). Permission-gated
 * (asset.print) and audit-logged — labels can be requested for any in-scope
 * asset. Reprints reuse the existing tag and scan token: printing never
 * mutates identity.
 */
@Injectable()
export class LabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** GET /assets/:id/label?format=svg|png&size=2x1|3x2 */
  async renderOne(
    user: AuthUser,
    assetId: string,
    format: LabelFormat,
    size: LabelSize,
    ctx: AuditContext,
  ): Promise<RenderedLabel> {
    const [data] = await this.loadLabelData(user, [assetId]);

    const rendered: RenderedLabel =
      format === 'png'
        ? {
            contentType: 'image/png',
            body: await renderLabelPng(data, size),
            filename: `${data.assetTag}.png`,
          }
        : {
            contentType: 'image/svg+xml',
            body: await renderLabelSvg(data, size),
            filename: `${data.assetTag}.svg`,
          };

    await this.audit.log({
      action: 'asset.label_printed',
      resourceType: 'asset',
      resourceId: assetId,
      metadata: { assetTag: data.assetTag, format, size },
      ...ctx,
    });
    return rendered;
  }

  /** POST /assets/labels/batch — one printable HTML sheet. */
  async renderBatch(
    user: AuthUser,
    dto: BatchLabelsDto,
    ctx: AuditContext,
  ): Promise<RenderedLabel> {
    const size = dto.size ?? '2x1';
    const uniqueIds = Array.from(new Set(dto.assetIds));
    const labels = await this.loadLabelData(user, uniqueIds);
    const svgs = await Promise.all(
      labels.map((label) => renderLabelSvg(label, size)),
    );

    await this.audit.log({
      action: 'asset.labels_batch_printed',
      resourceType: 'asset',
      metadata: {
        count: labels.length,
        assetTags: labels.map((label) => label.assetTag),
        size,
      },
      ...ctx,
    });
    return {
      contentType: 'text/html; charset=utf-8',
      body: renderBatchHtml(svgs, size),
      filename: 'asset-labels.html',
    };
  }

  /**
   * Branch-scoped load. Any requested asset that does not exist or is outside
   * the caller's branches fails the whole request with 404 — same behavior as
   * a direct fetch, no existence leak.
   */
  private async loadLabelData(
    user: AuthUser,
    assetIds: string[],
  ): Promise<Array<LabelData & { assetTag: string }>> {
    const rows = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        assetTag: true,
        scanToken: true,
        branchId: true,
        item: { select: { name: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return assetIds.map((id) => {
      const row = byId.get(id);
      if (!row || !this.branchScope.canAccess(user, row.branchId)) {
        throw AppException.notFound('Asset not found.');
      }
      return {
        assetTag: row.assetTag,
        itemName: row.item.name,
        // The QR encodes ONLY this opaque URL — never record data.
        scanUrl: buildScanUrl(this.config.webOrigin, row.scanToken),
      };
    });
  }
}
