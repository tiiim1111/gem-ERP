import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import {
  ApprovePurchaseOrderDto,
  CancelPurchaseOrderDto,
  ClosePurchaseOrderDto,
  CreatePurchaseOrderDto,
  QueryPurchaseOrdersDto,
  RejectPurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { GoodsReceiptsService } from './goods-receipts.service';
import {
  GoodsReceiptView,
  PurchaseOrderDetailView,
  PurchaseOrderView,
} from './procurement-views';
import { PurchaseOrdersService } from './purchase-orders.service';

@ApiTags('purchase-orders')
@ApiCookieAuth()
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly receipts: GoodsReceiptsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.procurementPo.view)
  @ApiOperation({
    summary:
      'List purchase orders (filters: status, supplierId, branchId, warehouseId, number, from, to). Branch-scoped by ordering branch; money fields need procurement.po.view_cost.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryPurchaseOrdersDto,
  ): Promise<Paginated<PurchaseOrderView>> {
    return this.purchaseOrders.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.procurementPo.create)
  @ApiOperation({
    summary:
      'Create a draft PO (number generated as PO-{YYYY}-{SEQ5}; line and document totals computed server-side).',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePurchaseOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderDetailView> {
    return this.purchaseOrders.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.procurementPo.view)
  @ApiOperation({
    summary: 'PO detail with lines, outstanding quantities, and receipt links.',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrderDetailView> {
    return this.purchaseOrders.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.procurementPo.update)
  @ApiOperation({
    summary:
      'Edit a DRAFT PO (requires version; lines replaced wholesale when provided; totals recomputed).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderDetailView> {
    return this.purchaseOrders.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.procurementPo.submit)
  @ApiOperation({
    summary:
      'Submit a draft. Auto-advances to APPROVED while no approval workflow matches (approval engine is Phase 6).',
  })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderDetailView> {
    return this.purchaseOrders.submit(user, id, auditContextFrom(req));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.procurementPo.approve)
  @ApiOperation({
    summary:
      'Approve a pending PO (self-approval → 409 SELF_APPROVAL_FORBIDDEN).',
  })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePurchaseOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderDetailView> {
    return this.purchaseOrders.approve(
      user,
      id,
      dto.comment,
      auditContextFrom(req),
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.procurementPo.approve)
  @ApiOperation({
    summary:
      'Reject a pending PO back to DRAFT for revision (comment mandatory; no self-rejection).',
  })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPurchaseOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderDetailView> {
    return this.purchaseOrders.reject(
      user,
      id,
      dto.comment,
      auditContextFrom(req),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.procurementPo.cancel)
  @ApiOperation({
    summary:
      'Cancel before any receipt exists (reason mandatory). Once received, close short instead.',
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPurchaseOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderDetailView> {
    return this.purchaseOrders.cancel(
      user,
      id,
      dto.reason,
      auditContextFrom(req),
    );
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.procurementPo.close)
  @ApiOperation({
    summary:
      'Close the PO — outstanding quantities are explicitly canceled (close short) once no receipts are in flight.',
  })
  close(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClosePurchaseOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderDetailView> {
    return this.purchaseOrders.close(
      user,
      id,
      dto.reason,
      auditContextFrom(req),
    );
  }

  @Get(':id/receipts')
  @RequirePermissions(PERMISSIONS.procurementReceipt.view)
  @ApiOperation({ summary: 'Goods receipts recorded against this PO.' })
  receiptsForPo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GoodsReceiptView[]> {
    return this.receipts.listForPurchaseOrder(user, id);
  }
}
