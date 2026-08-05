import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
  CancelGoodsReceiptDto,
  CreateGoodsReceiptDto,
  QueryGoodsReceiptsDto,
  ReverseGoodsReceiptDto,
  UpdateGoodsReceiptDto,
} from './dto/goods-receipt.dto';
import { GoodsReceiptPostingService } from './goods-receipt-posting.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import {
  GoodsReceiptDetailView,
  GoodsReceiptView,
} from './procurement-views';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Client-generated key (e.g. UUID). Replaying the same key returns the original result instead of receiving stock twice.',
};

@ApiTags('goods-receipts')
@ApiCookieAuth()
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(
    private readonly receipts: GoodsReceiptsService,
    private readonly posting: GoodsReceiptPostingService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.procurementReceipt.view)
  @ApiOperation({
    summary:
      'List goods receipts (filters: status, purchaseOrderId, supplierId, branchId, number, from, to). Branch-scoped.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryGoodsReceiptsDto,
  ): Promise<Paginated<GoodsReceiptView>> {
    return this.receipts.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.procurementReceipt.create)
  @ApiOperation({
    summary:
      'Create a draft receipt against an APPROVED/PARTIALLY_RECEIVED PO (GR-{YYYY}-{SEQ5}; quantities entered in the PO line UOM; serials required for SERIAL items, lots for LOT items). Nothing moves until posted.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateGoodsReceiptDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GoodsReceiptDetailView> {
    return this.receipts.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.procurementReceipt.view)
  @ApiOperation({
    summary:
      'Receipt detail with lines, created assets, lots, and the linked stock transaction.',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GoodsReceiptDetailView> {
    return this.receipts.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.procurementReceipt.create)
  @ApiOperation({
    summary:
      'Edit a DRAFT receipt (requires version; lines replaced wholesale when provided).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoodsReceiptDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GoodsReceiptDetailView> {
    return this.receipts.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/post')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.procurementReceipt.post)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary:
      'Post in ONE transaction: stock in via the posting engine, assets created for serialized lines, lots attached, PO rolled to PARTIALLY/FULLY_RECEIVED. Errors: OVER_RECEIPT, INVALID_STATE_TRANSITION, DUPLICATE_CODE (serials).',
  })
  post(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<GoodsReceiptDetailView> {
    return this.posting.post(user, id, idempotencyKey, auditContextFrom(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.procurementReceipt.cancel)
  @ApiOperation({
    summary: 'Cancel a DRAFT receipt (reason mandatory). Posted receipts are reversed instead.',
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelGoodsReceiptDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GoodsReceiptDetailView> {
    return this.receipts.cancel(user, id, dto.reason, auditContextFrom(req));
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.procurementReceipt.reverse)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary:
      'Reverse a POSTED receipt: offsetting ledger entries via the posting engine, created assets voided (must be untouched), PO outstanding restored. Errors: INSUFFICIENT_STOCK, INVALID_STATE_TRANSITION.',
  })
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ReverseGoodsReceiptDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GoodsReceiptDetailView> {
    return this.posting.reverse(
      user,
      id,
      idempotencyKey,
      dto.reason,
      auditContextFrom(req),
    );
  }
}
