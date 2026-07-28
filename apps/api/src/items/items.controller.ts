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
import { CreateItemDto } from './dto/create-item.dto';
import { CreateItemBarcodeDto } from './dto/item-barcode.dto';
import { QueryItemsDto, ResolveBarcodeQueryDto } from './dto/query-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { UpsertWarehouseSettingDto } from './dto/warehouse-setting.dto';
import { ItemBarcodesService, ResolvedBarcode } from './item-barcodes.service';
import {
  ItemWarehouseSettingsService,
  WarehouseSettingView,
} from './item-warehouse-settings.service';
import { ItemDetailView, ItemsService, ItemView } from './items.service';

@ApiTags('items')
@ApiCookieAuth()
@Controller('items')
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly barcodes: ItemBarcodesService,
    private readonly warehouseSettings: ItemWarehouseSettingsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.item.view)
  @ApiOperation({
    summary:
      'List items (filters: q, businessCategory, trackingMethod, categoryId, brandId, isActive, barcode). Costs need item.view_cost.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryItemsDto,
  ): Promise<Paginated<ItemView>> {
    return this.items.list(user, query);
  }

  // Declared before :id so "resolve-barcode" never matches the param route.
  @Get('resolve-barcode')
  @RequirePermissions(PERMISSIONS.item.view)
  @ApiOperation({
    summary:
      'Resolve a scanned code (SKU, item barcode, bin label, lot barcode) to its record.',
  })
  resolveBarcode(
    @CurrentUser() user: AuthUser,
    @Query() query: ResolveBarcodeQueryDto,
  ): Promise<ResolvedBarcode> {
    return this.barcodes.resolve(user, query.code);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.item.create)
  @ApiOperation({
    summary:
      'Create an item (SKU auto-generated as SKU-{CATEGORY}-{SEQ} when omitted; combos validated per spec §4).',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateItemDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ItemDetailView> {
    return this.items.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.item.view)
  @ApiOperation({
    summary: 'Item detail incl. barcodes, conversions, warehouse settings.',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemDetailView> {
    return this.items.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.item.update)
  @ApiOperation({
    summary:
      'Edit draft fields (requires version; trackingMethod immutable once stock/assets exist).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ItemDetailView> {
    return this.items.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.item.update)
  @ApiOperation({ summary: 'Enable the item for new transactions.' })
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ItemDetailView> {
    return this.items.setActive(user, id, true, auditContextFrom(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.item.update)
  @ApiOperation({ summary: 'Disable the item for new transactions.' })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ItemDetailView> {
    return this.items.setActive(user, id, false, auditContextFrom(req));
  }

  @Get(':id/barcodes')
  @RequirePermissions(PERMISSIONS.item.view)
  @ApiOperation({ summary: 'List all barcode mappings (active and archived).' })
  listBarcodes(@Param('id', ParseUUIDPipe) id: string) {
    return this.barcodes.listForItem(id);
  }

  @Post(':id/barcodes')
  @RequirePermissions(PERMISSIONS.item.update)
  @ApiOperation({
    summary:
      'Add an alternate barcode (duplicate ACTIVE mapping anywhere → 409 DUPLICATE_CODE).',
  })
  addBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateItemBarcodeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.barcodes.addToItem(id, dto, auditContextFrom(req));
  }

  @Delete(':id/barcodes/:barcodeId')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.item.update)
  @ApiOperation({ summary: 'Archive a barcode mapping (soft; history kept).' })
  async archiveBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.barcodes.archive(id, barcodeId, auditContextFrom(req));
  }

  @Get(':id/warehouse-settings')
  @RequirePermissions(PERMISSIONS.item.view)
  @ApiOperation({
    summary: 'Per-warehouse stocking rules (accessible branches only).',
  })
  listWarehouseSettings(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WarehouseSettingView[]> {
    return this.warehouseSettings.listForItem(user, id);
  }

  @Put(':id/warehouse-settings/:warehouseId')
  @RequirePermissions(PERMISSIONS.item.update)
  @ApiOperation({
    summary:
      'Upsert stocking rules for a warehouse (requires access to its branch).',
  })
  upsertWarehouseSetting(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() dto: UpsertWarehouseSettingDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WarehouseSettingView> {
    return this.warehouseSettings.upsert(
      user,
      id,
      warehouseId,
      dto,
      auditContextFrom(req),
    );
  }
}
