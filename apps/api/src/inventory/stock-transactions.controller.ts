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
import { CreateStockTransactionDto } from './dto/create-stock-transaction.dto';
import { QueryStockTransactionsDto } from './dto/query-stock-transactions.dto';
import {
  ApproveStockTransactionDto,
  CancelStockTransactionDto,
  PostStockTransactionDto,
  RejectStockTransactionDto,
  ReverseStockTransactionDto,
} from './dto/stock-transaction-actions.dto';
import { UpdateStockTransactionDto } from './dto/update-stock-transaction.dto';
import { StockPostingService } from './stock-posting.service';
import {
  StockTransactionDetailView,
  StockTransactionView,
} from './stock-transaction-views';
import { StockTransactionsService } from './stock-transactions.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Client-generated key (e.g. UUID). Replaying the same key returns the original result instead of moving stock twice.',
};

@ApiTags('stock-transactions')
@ApiCookieAuth()
@Controller('stock-transactions')
export class StockTransactionsController {
  constructor(
    private readonly transactions: StockTransactionsService,
    private readonly posting: StockPostingService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({
    summary:
      'List stock transactions (filters: type, status, branchId, warehouseId, itemId, number, from, to). Branch-scoped.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryStockTransactionsDto,
  ): Promise<Paginated<StockTransactionView>> {
    return this.transactions.list(user, query);
  }

  // The create/edit permission depends on the transaction type in the body
  // (receipts → inventory.receive, issues → inventory.issue, returns →
  // inventory.return, location transfers → inventory.transfer, adjustments →
  // inventory.adjust), so the guard-level decorator cannot express it; the
  // service enforces the per-type permission and throws 403.
  @Post()
  @ApiOperation({
    summary:
      'Create a draft stock transaction (per-type permission enforced server-side; UOM quantities normalized to base units).',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStockTransactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StockTransactionDetailView> {
    return this.transactions.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({
    summary: 'Transaction detail with lines, ledger links, and approval trail.',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StockTransactionDetailView> {
    return this.transactions.getById(user, id);
  }

  // Draft-only edit; per-type permission enforced in the service (see POST).
  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a DRAFT transaction (requires version; lines replaced wholesale when provided).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockTransactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StockTransactionDetailView> {
    return this.transactions.update(user, id, dto, auditContextFrom(req));
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
  ): Promise<StockTransactionDetailView> {
    return this.transactions.submit(user, id, auditContextFrom(req));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.approve)
  @ApiOperation({
    summary: 'Approve a pending transaction (self-approval → 409 SELF_APPROVAL_FORBIDDEN).',
  })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveStockTransactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StockTransactionDetailView> {
    return this.transactions.approve(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.approve)
  @ApiOperation({ summary: 'Reject a pending transaction (comment mandatory).' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectStockTransactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StockTransactionDetailView> {
    return this.transactions.reject(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/post')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.post)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary:
      'Post an APPROVED transaction: immutable ledger entries + atomic balance updates. Errors: INSUFFICIENT_STOCK, LOT_EXPIRED, INVALID_STATE_TRANSITION.',
  })
  post(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PostStockTransactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StockTransactionDetailView> {
    return this.posting.post(user, id, idempotencyKey, dto, auditContextFrom(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.cancel)
  @ApiOperation({ summary: 'Cancel a Draft/Pending/Approved transaction (reason mandatory).' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelStockTransactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StockTransactionDetailView> {
    return this.transactions.cancel(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.reverse)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary:
      'Create + post a linked REVERSAL of a POSTED transaction (reason mandatory). The original becomes REVERSED, never edited.',
  })
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ReverseStockTransactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StockTransactionDetailView> {
    return this.posting.reverse(user, id, idempotencyKey, dto, auditContextFrom(req));
  }
}
