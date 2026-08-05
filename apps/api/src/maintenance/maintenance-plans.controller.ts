import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
  CreateMaintenancePlanDto,
  QueryMaintenancePlansDto,
  ReplacePlanAssetsDto,
  UpdateMaintenancePlanDto,
} from './dto/maintenance-plan.dto';
import {
  MaintenancePlanDetailView,
  MaintenancePlanView,
} from './maintenance-views';
import { MaintenancePlansService } from './maintenance-plans.service';

/**
 * Preventive maintenance plans (api-outline 6.1). The contract's
 * `maintenance.plan.manage` maps onto the shared catalog's granular strings:
 * create → maintenance.plan.create, everything else mutable →
 * maintenance.plan.update (the catalog is owned by @gemerp/shared and has no
 * literal "manage" member).
 */
@ApiTags('maintenance-plans')
@ApiCookieAuth()
@Controller('maintenance-plans')
export class MaintenancePlansController {
  constructor(private readonly plans: MaintenancePlansService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.maintenancePlan.view)
  @ApiOperation({
    summary:
      'List plans (filters: q, isActive, assetId, dueBefore). Estimated cost needs maintenance.work_order.view_cost.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryMaintenancePlansDto,
  ): Promise<Paginated<MaintenancePlanView>> {
    return this.plans.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.maintenancePlan.create)
  @ApiOperation({
    summary:
      'Create a plan: frequency by interval/meter/cron, team or vendor, checklist, est. duration & cost, reminder lead time, covered assets.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMaintenancePlanDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaintenancePlanDetailView> {
    return this.plans.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.maintenancePlan.view)
  @ApiOperation({ summary: 'Plan detail with checklist and covered assets.' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MaintenancePlanDetailView> {
    return this.plans.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.maintenancePlan.update)
  @ApiOperation({
    summary:
      'Edit a plan (requires version; checklist replaced wholesale when provided).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaintenancePlanDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaintenancePlanDetailView> {
    return this.plans.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenancePlan.update)
  @ApiOperation({
    summary:
      'Enable scheduling. Re-anchors a dateless interval plan on today + interval.',
  })
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaintenancePlanDetailView> {
    return this.plans.setActive(user, id, true, auditContextFrom(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenancePlan.update)
  @ApiOperation({ summary: 'Pause scheduling (no new WOs are generated).' })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaintenancePlanDetailView> {
    return this.plans.setActive(user, id, false, auditContextFrom(req));
  }

  @Put(':id/assets')
  @RequirePermissions(PERMISSIONS.maintenancePlan.update)
  @ApiOperation({
    summary:
      'Replace the covered-asset set {assetIds[]} (each asset must be in the caller’s branch scope and not Retired/Disposed/Lost).',
  })
  replaceAssets(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplacePlanAssetsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaintenancePlanDetailView> {
    return this.plans.replaceAssets(user, id, dto, auditContextFrom(req));
  }
}
