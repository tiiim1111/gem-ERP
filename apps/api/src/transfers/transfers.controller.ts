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
import { CreateTransferDto } from './dto/create-transfer.dto';
import { QueryTransfersDto } from './dto/query-transfers.dto';
import {
  ApproveTransferDto,
  CancelTransferDto,
  ReceiveTransferDto,
  RejectTransferDto,
} from './dto/transfer-actions.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import {
  TransferDetailView,
  TransfersService,
  TransferView,
} from './transfers.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Client-generated key (e.g. UUID). Replaying the same key returns the original result instead of moving stock twice.',
};

@ApiTags('transfers')
@ApiCookieAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.transfer.view)
  @ApiOperation({
    summary:
      'List transfers (filters: status, kind, sourceBranchId, destinationBranchId, number, from, to). Visible with source OR destination branch access.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryTransfersDto,
  ): Promise<Paginated<TransferView>> {
    return this.transfers.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.transfer.create)
  @ApiOperation({
    summary:
      'Create a draft transfer (LOCATION, INTRA_BRANCH, or INTER_BRANCH). Requires source-branch access.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransferDetailView> {
    return this.transfers.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.transfer.view)
  @ApiOperation({ summary: 'Transfer detail with line states, receipts, and stock-transaction legs.' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransferDetailView> {
    return this.transfers.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.transfer.update)
  @ApiOperation({ summary: 'Edit a DRAFT transfer (requires version).' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransferDetailView> {
    return this.transfers.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.transfer.submit)
  @ApiOperation({
    summary:
      'Submit a draft. Auto-advances to APPROVED while no approval workflow matches (approval engine is Phase 6).',
  })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransferDetailView> {
    return this.transfers.submit(user, id, auditContextFrom(req));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.transfer.approve)
  @ApiOperation({
    summary: 'Approve a pending transfer (self-approval → 409 SELF_APPROVAL_FORBIDDEN).',
  })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransferDetailView> {
    return this.transfers.approve(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.transfer.approve)
  @ApiOperation({ summary: 'Reject a pending transfer (comment mandatory).' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransferDetailView> {
    return this.transfers.reject(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.transfer.dispatch)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary:
      'Dispatch an approved transfer (source-branch access): posts the source-out leg; inter-branch stock moves to the in-transit bucket. Intra-branch transfers complete immediately.',
  })
  dispatch(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransferDetailView> {
    return this.transfers.dispatch(user, id, idempotencyKey, auditContextFrom(req));
  }

  @Post(':id/receive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.transfer.receive)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary:
      'Receive an in-transit transfer (destination-branch access): per-line received/damaged/short counts, destination-in ledger, in-transit cleared.',
  })
  receive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ReceiveTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransferDetailView> {
    return this.transfers.receive(user, id, idempotencyKey, dto, auditContextFrom(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.transfer.cancel)
  @ApiOperation({ summary: 'Cancel before dispatch (reason mandatory).' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransferDetailView> {
    return this.transfers.cancel(user, id, dto, auditContextFrom(req));
  }
}
