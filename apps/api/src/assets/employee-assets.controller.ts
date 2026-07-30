import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types/auth-request';
import {
  EmployeeAcknowledgmentsView,
  EmployeeAssetsService,
} from './employee-assets.service';

/**
 * Employee custody sub-resources (api-outline 3.1, P3 rows). Lives in the
 * assets module — the employees module stays Phase 2-only — but mounts under
 * /employees/:id/* as the contract requires.
 */
@ApiTags('employees')
@ApiCookieAuth()
@Controller('employees')
export class EmployeeAssetsController {
  constructor(private readonly employeeAssets: EmployeeAssetsService) {}

  @Get(':id/assets')
  @RequirePermissions(PERMISSIONS.employee.view, PERMISSIONS.asset.view)
  @ApiOperation({ summary: 'Assets currently assigned to the employee.' })
  currentAssets(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.employeeAssets.currentAssets(user, id);
  }

  @Get(':id/acknowledgments')
  @RequirePermissions(PERMISSIONS.employee.view, PERMISSIONS.asset.view)
  @ApiOperation({
    summary:
      'Outstanding issue acknowledgments and overdue expected returns for the employee.',
  })
  acknowledgments(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeAcknowledgmentsView> {
    return this.employeeAssets.acknowledgments(user, id);
  }

  @Get(':id/issuances')
  @RequirePermissions(PERMISSIONS.employee.view, PERMISSIONS.inventory.view)
  @ApiOperation({
    summary:
      'Consumable issuance history (posted stock issues referencing the employee; empty until issues are posted).',
  })
  issuances(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.employeeAssets.issuances(user, id);
  }
}
