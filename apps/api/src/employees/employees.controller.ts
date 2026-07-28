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
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  DeactivateEmployeeDto,
  SeparateEmployeeDto,
} from './dto/employee-actions.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import {
  EmployeesService,
  EmployeeView,
  SeparationResult,
} from './employees.service';

@ApiTags('employees')
@ApiCookieAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.employee.view)
  @ApiOperation({
    summary:
      'List employees (branch-scoped; filters: q, branchId, departmentId, positionId, status).',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryEmployeesDto,
  ): Promise<Paginated<EmployeeView>> {
    return this.employees.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.employee.create)
  @ApiOperation({
    summary:
      'Create an employee (employee number auto-generated as EMP-{SEQ} when omitted).',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEmployeeDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EmployeeView> {
    return this.employees.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.employee.view)
  @ApiOperation({
    summary:
      'Employee detail (404 out of scope; restricted notes only with employee.view_notes).',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeView> {
    return this.employees.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.employee.update)
  @ApiOperation({
    summary:
      'Edit draft fields (requires current `version`; mismatch → 409 VERSION_CONFLICT).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EmployeeView> {
    return this.employees.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.employee.update)
  @ApiOperation({ summary: 'Set employment status to ACTIVE (rehire clears separation date).' })
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<EmployeeView> {
    return this.employees.activate(user, id, auditContextFrom(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.employee.update)
  @ApiOperation({ summary: 'Set INACTIVE or SUSPENDED with a reason (audited).' })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivateEmployeeDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EmployeeView> {
    return this.employees.deactivate(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/separate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.employee.archive)
  @ApiOperation({
    summary:
      'Separation workflow — returns outstanding assigned assets; assets are never auto-returned.',
  })
  separate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SeparateEmployeeDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SeparationResult> {
    return this.employees.separate(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.employee.archive)
  @ApiOperation({
    summary:
      'Soft archive after separation — 409 while assets remain in custody.',
  })
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<EmployeeView> {
    return this.employees.archive(user, id, auditContextFrom(req));
  }
}
