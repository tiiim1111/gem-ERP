import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../../common/types/auth-request';
import { HrisAdminService, type HrisMappingsView, type HrisRunView, type HrisStatusView } from './hris-admin.service';
import { QueueRunDto, UpdateDepartmentMapDto, UpdatePositionMapDto, QueryRunsDto } from './dto/hris.dto';

/**
 * Administration of the HRIS employee feed.
 *
 * Every route is gated on integration.manage, which is deliberately narrower
 * than employee.view: seeing an employee's HRIS source badge is ordinary
 * employee access, while the connection settings, the code mappings and the
 * run history with its row-level errors are not.
 */
@ApiTags('integrations')
@ApiCookieAuth()
@Controller('integrations/hris')
export class HrisController {
  constructor(private readonly admin: HrisAdminService) {}

  /*
   * Deliberately separate from `status` and gated on ordinary employee access:
   * the employee screens need to know whether to offer manual creation, and
   * "employees come from the HRIS" is not operational detail — the source
   * badge already says it. Nothing about the connection is included.
   */
  @Get('employee-source')
  @RequirePermissions(PERMISSIONS.employee.view)
  @ApiOperation({
    summary: 'Whether employees are maintained by the HRIS feed. Employee-view permission.',
  })
  employeeSource(): { hrisManaged: boolean } {
    return this.admin.employeeSource();
  }

  @Get('status')
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({
    summary: 'Connection status, last successful run and whether sync is enabled.',
  })
  status(): Promise<HrisStatusView> {
    return this.admin.status();
  }

  @Post('probe')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({
    summary: 'Redacted connectivity test — reports counts and metadata, never employee data.',
  })
  probe(): Promise<{ ok: boolean; message: string; total?: number; companyCode?: string }> {
    return this.admin.probe();
  }

  @Get('runs')
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({ summary: 'Sync run history, newest first.' })
  runs(@Query() query: QueryRunsDto): Promise<{ data: HrisRunView[] }> {
    return this.admin.runs(query);
  }

  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({ summary: 'One run with its row-level issues.' })
  run(@Param('id', ParseUUIDPipe) id: string): Promise<HrisRunView> {
    return this.admin.run(id);
  }

  @Post('runs')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({
    summary:
      'Queue a sync. `dryRun` rehearses with zero writes through the identical decision path.',
  })
  queue(@CurrentUser() user: AuthUser, @Body() dto: QueueRunDto): Promise<{ id: string }> {
    return this.admin.queue(user, dto);
  }

  @Get('mappings')
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({
    summary: 'HRIS department/position codes with their GEM-ENI targets and review state.',
  })
  mappings(): Promise<HrisMappingsView> {
    return this.admin.mappings();
  }

  @Post('mappings/adopt')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({
    summary:
      'Create a GEM-ENI department/position for every unmapped HRIS code and point the mapping at it. Explicit and audited — the sync never creates organisational records itself.',
  })
  adopt(@CurrentUser() user: AuthUser): Promise<{
    mappings: HrisMappingsView;
    createdDepartments: string[];
    createdPositions: string[];
    linkedExisting: string[];
  }> {
    return this.admin.adoptUnmappedCodes(user);
  }

  @Patch('mappings/departments/:id')
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({ summary: 'Point an HRIS department code at a GEM-ENI department.' })
  setDepartmentMap(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentMapDto,
  ): Promise<HrisMappingsView> {
    return this.admin.setDepartmentMap(user, id, dto);
  }

  @Patch('mappings/positions/:id')
  @RequirePermissions(PERMISSIONS.integration.manage)
  @ApiOperation({ summary: 'Point an HRIS position code at a GEM-ENI position.' })
  setPositionMap(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePositionMapDto,
  ): Promise<HrisMappingsView> {
    return this.admin.setPositionMap(user, id, dto);
  }
}
