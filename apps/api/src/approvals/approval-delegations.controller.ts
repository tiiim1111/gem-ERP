import {
  Body,
  Controller,
  Delete,
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
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { ApprovalDelegationsService } from './approval-delegations.service';
import { DelegationView } from './approval-views';
import {
  CreateApprovalDelegationDto,
  QueryApprovalDelegationsDto,
} from './dto/approval-delegation.dto';

@ApiTags('approvals')
@ApiCookieAuth()
@Controller('approval-delegations')
export class ApprovalDelegationsController {
  constructor(private readonly delegations: ApprovalDelegationsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Own delegations (given or received); ?all=true lists everyone’s (approval.manage).',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryApprovalDelegationsDto,
  ): Promise<Paginated<DelegationView>> {
    return this.delegations.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.approval.delegate)
  @ApiOperation({
    summary:
      'Delegate own approval authority for a time window {delegateUserId, startsAt, endsAt}.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApprovalDelegationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<DelegationView> {
    return this.delegations.create(user, dto, auditContextFrom(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Revoke a delegation (soft: isActive=false). Own only, unless approval.manage.',
  })
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.delegations.revoke(user, id, auditContextFrom(req));
  }
}
