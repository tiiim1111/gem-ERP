import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { ApprovalEngineService } from './approval-engine.service';
import { ApprovalRequestsService } from './approval-requests.service';
import { RequestDetailView, RequestView } from './approval-views';
import {
  ApproveApprovalRequestDto,
  QueryApprovalRequestsDto,
  RejectApprovalRequestDto,
  ReturnApprovalRequestDto,
} from './dto/approval-request.dto';

/**
 * Approval inbox + decisions (api-outline 7.2). No @RequirePermissions on
 * purpose: visibility is self-scoped (own + assigned; approval.view widens
 * it — enforced in the service), and acting requires being the CURRENT
 * step's resolved assignee or an in-window delegate — enforced by the
 * engine, because holding a permission alone is never enough (spec §19).
 */
@ApiTags('approvals')
@ApiCookieAuth()
@Controller('approval-requests')
export class ApprovalRequestsController {
  constructor(
    private readonly requests: ApprovalRequestsService,
    private readonly engine: ApprovalEngineService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Approval queue (filters: status, documentType, branchId, assignedToMe). Own + assigned always visible; the rest needs approval.view.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryApprovalRequestsDto,
  ): Promise<Paginated<RequestView>> {
    return this.requests.list(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Request detail with resolved steps and full action history.',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RequestDetailView> {
    return this.requests.getById(user, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Approve the current step — advances to the next step or finalizes (the document transition then executes). Self-approval → 409 SELF_APPROVAL_FORBIDDEN.',
  })
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveApprovalRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RequestDetailView> {
    await this.engine.act(user, id, 'APPROVE', dto.comment, auditContextFrom(req));
    return this.requests.getById(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject (comment REQUIRED) — the document takes its reject path.',
  })
  async reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApprovalRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RequestDetailView> {
    await this.engine.act(user, id, 'REJECT', dto.comment, auditContextFrom(req));
    return this.requests.getById(user, id);
  }

  @Post(':id/return')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Return for revision (comment REQUIRED) — the document goes back to Draft.',
  })
  async returnForRevision(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnApprovalRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RequestDetailView> {
    await this.engine.act(user, id, 'RETURN', dto.comment, auditContextFrom(req));
    return this.requests.getById(user, id);
  }
}
