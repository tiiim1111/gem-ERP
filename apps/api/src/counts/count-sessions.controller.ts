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
  CountAdjustmentsService,
  CreateAdjustmentsResult,
} from './count-adjustments.service';
import { CountSessionsService } from './count-sessions.service';
import {
  CountLineView,
  CountSessionDetailView,
  CountSessionView,
} from './count-views';
import {
  CancelCountSessionDto,
  CreateCountAdjustmentsDto,
  CreateCountSessionDto,
  QueryCountSessionsDto,
  RecordCountDto,
  RecountDto,
  ScanCountDto,
  UpdateCountSessionDto,
} from './dto/count-session.dto';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Client-generated key (e.g. UUID). Replaying the same key returns the original result instead of generating adjustment drafts twice.',
};

@ApiTags('count-sessions')
@ApiCookieAuth()
@Controller('count-sessions')
export class CountSessionsController {
  constructor(
    private readonly sessions: CountSessionsService,
    private readonly adjustments: CountAdjustmentsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.count.view)
  @ApiOperation({
    summary:
      'List count sessions (filters: status, type, branchId, warehouseId, number, from, to). Branch-scoped.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryCountSessionsDto,
  ): Promise<Paginated<CountSessionView>> {
    return this.sessions.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.count.create)
  @ApiOperation({
    summary:
      'Create a draft count session {type: full|cycle, blind, scope: {branchId, warehouseId?, locationId?, categoryId?, itemIds?}}.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCountSessionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CountSessionDetailView> {
    return this.sessions.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.count.view)
  @ApiOperation({
    summary:
      'Session detail with lines and linked adjustment drafts. Blind sessions hide expected quantities until complete.',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CountSessionDetailView> {
    return this.sessions.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.count.create)
  @ApiOperation({ summary: 'Edit a DRAFT session (requires version).' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCountSessionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CountSessionDetailView> {
    return this.sessions.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.count.create)
  @ApiOperation({
    summary:
      'Freeze/snapshot expected balances and asset locations into count lines (one atomic transaction — later stock movement cannot corrupt variance math).',
  })
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CountSessionDetailView> {
    return this.sessions.start(user, id, auditContextFrom(req));
  }

  @Post(':id/lines/:lineId/count')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.count.record)
  @ApiOperation({
    summary:
      'Record a count: {countedQty} for stock lines, {found, conditionId?, locationConfirmed?} for asset lines. Flags missing/unexpected/duplicate/misplaced.',
  })
  recordLine(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: RecordCountDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CountLineView> {
    return this.sessions.recordLine(user, id, lineId, dto, auditContextFrom(req));
  }

  @Post(':id/scans')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.count.record)
  @ApiOperation({
    summary:
      'Rapid-scan entry {code, qty?}: resolves SKUs, alternate barcodes, lots, asset tags, and serials; quantities accumulate; finds outside the snapshot become UNEXPECTED lines.',
  })
  scan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScanCountDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CountLineView> {
    return this.sessions.scan(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/recount')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.count.record)
  @ApiOperation({
    summary:
      'Reopen selected lines for recount {lineIds[]}. Reopening from REVIEW returns the session to counting.',
  })
  recount(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecountDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CountSessionDetailView> {
    return this.sessions.recount(user, id, dto, auditContextFrom(req));
  }

  @Get(':id/variance')
  @RequirePermissions(PERMISSIONS.count.view)
  @ApiOperation({
    summary:
      'Variance report: expected vs counted vs recount per line plus summary totals (masked while a blind session is still counting).',
  })
  variance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): ReturnType<CountSessionsService['variance']> {
    return this.sessions.variance(user, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.count.approve)
  @ApiOperation({
    summary:
      'Close counting: locks lines, freezes per-line variance and flags (session → REVIEW).',
  })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CountSessionDetailView> {
    return this.sessions.complete(user, id, auditContextFrom(req));
  }

  @Post(':id/create-adjustments')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.count.approve)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary:
      'Generate DRAFT stock-adjustment transactions from the frozen variances — one draft per warehouse and direction, linked to the session; they flow through the ordinary §4.1 approval + posting machine. Idempotency-Key REQUIRED.',
  })
  createAdjustments(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCountAdjustmentsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CreateAdjustmentsResult> {
    return this.adjustments.createAdjustments(
      user,
      id,
      idempotencyKey,
      dto,
      auditContextFrom(req),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.count.cancel)
  @ApiOperation({ summary: 'Cancel the session ({reason} mandatory).' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCountSessionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CountSessionDetailView> {
    return this.sessions.cancel(user, id, dto, auditContextFrom(req));
  }
}
