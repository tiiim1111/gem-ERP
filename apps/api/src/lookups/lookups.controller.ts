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
import { ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import type { LookupValue } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
} from '../common/types/auth-request';
import {
  CreateLookupValueDto,
  LookupQueryDto,
  UpdateLookupValueDto,
} from './dto/lookup-common.dto';
import { LOOKUP_TYPES } from './lookup-types';
import { LookupsService } from './lookups.service';

const TYPE_PARAM = {
  name: 'type',
  enum: Object.keys(LOOKUP_TYPES),
  description: 'Lookup type (spec §10).',
};

@ApiTags('lookups')
@ApiCookieAuth()
@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get(':type')
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiParam(TYPE_PARAM)
  @ApiOperation({ summary: 'List values of a lookup type (sorted by sortOrder).' })
  list(
    @Param('type') type: string,
    @Query() query: LookupQueryDto,
  ): Promise<Paginated<LookupValue>> {
    return this.lookups.list(type, query);
  }

  @Post(':type')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiParam(TYPE_PARAM)
  @ApiOperation({ summary: 'Create a lookup value (code unique per type).' })
  create(
    @Param('type') type: string,
    @Body() dto: CreateLookupValueDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LookupValue> {
    return this.lookups.create(type, dto, auditContextFrom(req));
  }

  @Patch(':type/:id')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiParam(TYPE_PARAM)
  @ApiOperation({ summary: 'Edit / activate / deactivate a lookup value.' })
  update(
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLookupValueDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LookupValue> {
    return this.lookups.update(type, id, dto, auditContextFrom(req));
  }

  @Delete(':type/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiParam(TYPE_PARAM)
  @ApiOperation({
    summary: 'Delete an unreferenced value (409 IN_USE once referenced — deactivate instead).',
  })
  async remove(
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.lookups.remove(type, id, auditContextFrom(req));
  }
}
