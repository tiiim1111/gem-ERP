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
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PERMISSIONS } from '@gemerp/shared';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
} from '../common/types/auth-request';
import { LookupQueryDto, toBoolean } from './dto/lookup-common.dto';
import {
  CreateUomConversionDto,
  CreateUomDto,
  UpdateUomConversionDto,
  UpdateUomDto,
} from './dto/uom.dto';
import { UomsService } from './uoms.service';

export class QueryUomConversionsDto extends LookupQueryDto {
  @ApiPropertyOptional({ description: 'Only conversions of this item.' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true → only global (non-item) conversions.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  global?: boolean;
}

@ApiTags('catalog')
@ApiCookieAuth()
@Controller('uoms')
export class UomsController {
  constructor(private readonly uoms: UomsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'List units of measure.' })
  list(@Query() query: LookupQueryDto) {
    return this.uoms.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Create a unit of measure (unique code).' })
  create(@Body() dto: CreateUomDto, @Req() req: AuthenticatedRequest) {
    return this.uoms.create(dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'UOM detail.' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.uoms.getById(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Edit / activate / deactivate a UOM.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.uoms.update(id, dto, auditContextFrom(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Delete an unreferenced UOM (409 IN_USE once referenced).' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.uoms.remove(id, auditContextFrom(req));
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@Controller('uom-conversions')
export class UomConversionsController {
  constructor(private readonly uoms: UomsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({
    summary:
      'List UOM conversions (global and item-specific; filters: itemId, global).',
  })
  list(@Query() query: QueryUomConversionsDto) {
    return this.uoms.listConversions(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({
    summary:
      'Create a conversion (1 fromUom = factor × toUom); omit itemId for global.',
  })
  create(
    @Body() dto: CreateUomConversionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.uoms.createConversion(dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'Conversion detail.' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.uoms.getConversion(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Update the conversion factor.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUomConversionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.uoms.updateConversion(id, dto, auditContextFrom(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Delete a conversion.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.uoms.removeConversion(id, auditContextFrom(req));
  }
}
