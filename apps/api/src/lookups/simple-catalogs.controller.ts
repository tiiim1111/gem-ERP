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
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
} from '../common/types/auth-request';
import {
  CreateCodeNameDto,
  LookupQueryDto,
  UpdateCodeNameDto,
} from './dto/lookup-common.dto';
import {
  SimpleCatalogEntry,
  SimpleCatalogKind,
  SimpleCatalogsService,
} from './simple-catalogs.service';

/**
 * Positions, brands, and manufacturers share one contract (api-outline
 * 3.2/3.5): read `lookup.view`, write `lookup.manage`, PATCH toggles
 * `isActive`, delete-protected once referenced.
 */
abstract class SimpleCatalogController {
  protected abstract readonly kind: SimpleCatalogKind;

  constructor(protected readonly catalogs: SimpleCatalogsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'List entries (q / isActive filters, sorted by code).' })
  list(@Query() query: LookupQueryDto): Promise<Paginated<SimpleCatalogEntry>> {
    return this.catalogs.list(this.kind, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Create an entry (unique code).' })
  create(
    @Body() dto: CreateCodeNameDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SimpleCatalogEntry> {
    return this.catalogs.create(this.kind, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'Entry detail.' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SimpleCatalogEntry> {
    return this.catalogs.getById(this.kind, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Edit / activate / deactivate an entry.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCodeNameDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SimpleCatalogEntry> {
    return this.catalogs.update(this.kind, id, dto, auditContextFrom(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Delete an unreferenced entry (409 IN_USE once referenced).' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.catalogs.remove(this.kind, id, auditContextFrom(req));
  }
}

// Subclasses declare explicit constructors: TypeScript only emits the
// design:paramtypes DI metadata for classes with their own constructor.

@ApiTags('lookups')
@ApiCookieAuth()
@Controller('positions')
export class PositionsController extends SimpleCatalogController {
  protected readonly kind = 'position' as const;

  constructor(catalogs: SimpleCatalogsService) {
    super(catalogs);
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@Controller('brands')
export class BrandsController extends SimpleCatalogController {
  protected readonly kind = 'brand' as const;

  constructor(catalogs: SimpleCatalogsService) {
    super(catalogs);
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@Controller('manufacturers')
export class ManufacturersController extends SimpleCatalogController {
  protected readonly kind = 'manufacturer' as const;

  constructor(catalogs: SimpleCatalogsService) {
    super(catalogs);
  }
}
