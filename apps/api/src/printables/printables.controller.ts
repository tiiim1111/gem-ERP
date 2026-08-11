import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { PrintableFile, PrintablesService } from './printables.service';

/**
 * Phase 7 printable documents (api-outline §8). The routes live under the
 * parent resources' prefixes (/purchase-orders/:id/pdf, ...) but are owned
 * by this dedicated controller — existing modules are not touched. Each
 * render requires the parent's view permission, is branch-scoped
 * (out-of-scope → 404), and is audit-logged.
 */
@ApiTags('printables')
@ApiCookieAuth()
@Controller()
export class PrintablesController {
  constructor(private readonly printables: PrintablesService) {}

  @Get('purchase-orders/:id/pdf')
  @RequirePermissions(PERMISSIONS.procurementPo.view)
  @ApiOperation({
    summary:
      'Purchase order PDF (prices only with procurement.po.view_cost). Render is audit-logged.',
  })
  async purchaseOrderPdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.send(
      res,
      await this.printables.purchaseOrderPdf(user, id, auditContextFrom(req)),
    );
  }

  @Get('goods-receipts/:id/pdf')
  @RequirePermissions(PERMISSIONS.procurementReceipt.view)
  @ApiOperation({
    summary:
      'Receiving report PDF (unit costs only with procurement.po.view_cost). Render is audit-logged.',
  })
  async goodsReceiptPdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.send(
      res,
      await this.printables.goodsReceiptPdf(user, id, auditContextFrom(req)),
    );
  }

  @Get('transfers/:id/pdf')
  @RequirePermissions(PERMISSIONS.transfer.view)
  @ApiOperation({
    summary:
      'Transfer document PDF (visible with source or destination branch access). Render is audit-logged.',
  })
  async transferPdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.send(
      res,
      await this.printables.transferPdf(user, id, auditContextFrom(req)),
    );
  }

  @Get('assets/:id/acknowledgment-form')
  @RequirePermissions(PERMISSIONS.asset.view)
  @ApiOperation({
    summary:
      'Custody / acknowledgment form PDF with received-by (custodian) and issued-by signature blocks. Render is audit-logged.',
  })
  async acknowledgmentForm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.send(
      res,
      await this.printables.assetAcknowledgmentForm(
        user,
        id,
        auditContextFrom(req),
      ),
    );
  }

  @Get('maintenance-work-orders/:id/pdf')
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary:
      'Work order PDF with checklist, parts, and (with maintenance.work_order.view_cost) cost totals. Render is audit-logged.',
  })
  async workOrderPdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.send(
      res,
      await this.printables.workOrderPdf(user, id, auditContextFrom(req)),
    );
  }

  @Get('count-sessions/:id/sheet')
  @RequirePermissions(PERMISSIONS.count.view)
  @ApiOperation({
    summary:
      'Inventory count sheet PDF with counter/verifier signature blocks; expected quantities masked while a blind session is counting. Render is audit-logged.',
  })
  async countSheet(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.send(
      res,
      await this.printables.countSheet(user, id, auditContextFrom(req)),
    );
  }

  private send(res: Response, file: PrintableFile): StreamableFile {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(file.buffer.length));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/"/g, '')}"`,
    );
    return new StreamableFile(file.buffer);
  }
}
