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
  ApproveSupplierReturnDto,
  CancelSupplierReturnDto,
  CreateSupplierReturnDto,
  PostSupplierReturnDto,
  QuerySupplierReturnsDto,
  UpdateSupplierReturnDto,
} from './dto/supplier-return.dto';
import {
  SupplierReturnDetailView,
  SupplierReturnView,
} from './procurement-views';
import { SupplierReturnsService } from './supplier-returns.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Client-generated key (e.g. UUID). Replaying the same key returns the original result instead of moving stock twice.',
};

// The shared permission catalog has no procurement.return.* strings
// (api-outline 5.4 sketches them; appendix A mirrors the catalog). Returns
// move stock OUT to a supplier, so the inventory return/post permissions
// govern them, with approval.act for decisions — same convention the
// stock-transactions controller documents for its approve/reject routes.
@ApiTags('supplier-returns')
@ApiCookieAuth()
@Controller('supplier-returns')
export class SupplierReturnsController {
  constructor(private readonly returns: SupplierReturnsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({
    summary:
      'List supplier returns (filters: status, supplierId, branchId, goodsReceiptId, from, to). Branch-scoped.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QuerySupplierReturnsDto,
  ): Promise<Paginated<SupplierReturnView>> {
    return this.returns.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.inventory.return)
  @ApiOperation({
    summary:
      'Create a draft return-to-supplier document (SRN-{YYYY}-{SEQ5}) referencing received stock (optionally a specific goods receipt).',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSupplierReturnDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierReturnDetailView> {
    return this.returns.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({ summary: 'Supplier return detail with lines.' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierReturnDetailView> {
    return this.returns.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.inventory.return)
  @ApiOperation({
    summary:
      'Edit a DRAFT return (requires version; lines replaced wholesale when provided).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierReturnDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierReturnDetailView> {
    return this.returns.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.submit)
  @ApiOperation({
    summary:
      'Submit a draft. Auto-advances to APPROVED while no approval workflow matches (approval engine is Phase 6).',
  })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierReturnDetailView> {
    return this.returns.submit(user, id, auditContextFrom(req));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.approval.act)
  @ApiOperation({
    summary:
      'Approve a pending return (self-approval → 409 SELF_APPROVAL_FORBIDDEN).',
  })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveSupplierReturnDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierReturnDetailView> {
    return this.returns.approve(user, id, dto.comment, auditContextFrom(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.cancel)
  @ApiOperation({
    summary: 'Cancel a Draft/Pending/Approved return (reason mandatory).',
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSupplierReturnDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierReturnDetailView> {
    return this.returns.cancel(user, id, dto.reason, auditContextFrom(req));
  }

  @Post(':id/post')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.post)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary:
      'Post the stock-out to the supplier: one transaction creating + posting a linked RETURN_TO_SUPPLIER stock transaction via the posting engine. Errors: INSUFFICIENT_STOCK, INVALID_STATE_TRANSITION.',
  })
  post(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PostSupplierReturnDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierReturnDetailView> {
    return this.returns.post(
      user,
      id,
      idempotencyKey,
      dto.allowExpiredLots ?? true,
      auditContextFrom(req),
    );
  }
}
