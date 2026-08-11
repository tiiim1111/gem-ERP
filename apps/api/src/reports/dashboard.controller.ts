import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types/auth-request';
import { DashboardService, DashboardSummaryView } from './dashboard.service';

@ApiTags('dashboard')
@ApiCookieAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.report.view)
  @ApiOperation({
    summary:
      'Dashboard KPIs from live queries: assets by status/condition, assigned vs available, SKU counts, low/out-of-stock, pending transfers & approvals, maintenance due/overdue, open WOs, warranty & lot expirations (30d), recent transactions, open POs/receipts. Branch-scoped; inventory/acquisition values only with the relevant *.view_cost permission.',
  })
  summary(@CurrentUser() user: AuthUser): Promise<DashboardSummaryView> {
    return this.dashboard.summary(user);
  }
}
