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
import { ApprovalWorkflowsService } from './approval-workflows.service';
import { WorkflowDetailView, WorkflowView } from './approval-views';
import {
  CreateApprovalWorkflowDto,
  QueryApprovalWorkflowsDto,
  UpdateApprovalWorkflowDto,
} from './dto/approval-workflow.dto';

@ApiTags('approvals')
@ApiCookieAuth()
@Controller('approval-workflows')
export class ApprovalWorkflowsController {
  constructor(private readonly workflows: ApprovalWorkflowsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.approval.manage)
  @ApiOperation({
    summary:
      'List approval workflows (filters: documentType, branchId, isActive).',
  })
  list(
    @Query() query: QueryApprovalWorkflowsDto,
  ): Promise<Paginated<WorkflowView>> {
    return this.workflows.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.approval.manage)
  @ApiOperation({
    summary:
      'Create a workflow: document type, branch scope, amount/quantity thresholds, ordered steps (ROLE | POSITION | DEPT_HEAD | USER per step).',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApprovalWorkflowDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkflowDetailView> {
    return this.workflows.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.approval.manage)
  @ApiOperation({ summary: 'Workflow detail including resolved step config.' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<WorkflowDetailView> {
    return this.workflows.getById(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.approval.manage)
  @ApiOperation({
    summary:
      'Edit a workflow. Step replacement is refused (409 IN_USE) while requests are pending.',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApprovalWorkflowDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkflowDetailView> {
    return this.workflows.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.approval.manage)
  @ApiOperation({ summary: 'Activate the workflow for routing.' })
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkflowDetailView> {
    return this.workflows.setActive(user, id, true, auditContextFrom(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.approval.manage)
  @ApiOperation({
    summary:
      'Deactivate: new submissions stop routing here; in-flight requests finish normally.',
  })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkflowDetailView> {
    return this.workflows.setActive(user, id, false, auditContextFrom(req));
  }
}
