import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import type { ReportRow } from '@gemerp/reports';
import { REPORT_KEYS } from '@gemerp/reports';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types/auth-request';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportCatalogEntry, ReportsService } from './reports.service';

@ApiTags('reports')
@ApiCookieAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.report.view)
  @ApiOperation({
    summary:
      'Report catalog: the caller\'s runnable subset (report.view + each report\'s underlying permission), with filter keys and column definitions.',
  })
  catalog(@CurrentUser() user: AuthUser): ReportCatalogEntry[] {
    return this.reports.catalog(user);
  }

  @Get(':key')
  @RequirePermissions(PERMISSIONS.report.view)
  @ApiParam({
    name: 'key',
    description: `Report key: ${REPORT_KEYS.join(' | ')}`,
  })
  @ApiOperation({
    summary:
      'Run one registry report (asset-register, stock-on-hand, po-status, ...). Requires report.view + the report\'s underlying permission; branch-scoped always; §1.4 filters validated per report; cost columns only with the matching *.view_cost.',
  })
  run(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query() query: ReportQueryDto,
  ): Promise<Paginated<ReportRow>> {
    return this.reports.run(user, key, query);
  }
}
