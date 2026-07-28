import {
  Body,
  Controller,
  Delete,
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
import { PERMISSIONS } from '@gemerp/shared';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
} from '../common/types/auth-request';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { LookupQueryDto } from './dto/lookup-common.dto';

@ApiTags('lookups')
@ApiCookieAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'List departments (global reference data).' })
  list(@Query() query: LookupQueryDto) {
    return this.departments.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Create a department (optional head employee).' })
  create(@Body() dto: CreateDepartmentDto, @Req() req: AuthenticatedRequest) {
    return this.departments.create(dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'Department detail incl. head employee.' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.getById(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({
    summary: 'Edit / toggle isActive / assign the department head.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.departments.update(id, dto, auditContextFrom(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({
    summary: 'Delete an unreferenced department (409 IN_USE once referenced).',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.departments.remove(id, auditContextFrom(req));
  }
}
