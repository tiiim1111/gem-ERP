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
import {
  CreateItemCategoryDto,
  UpdateItemCategoryDto,
} from './dto/item-category.dto';
import { LookupQueryDto } from './dto/lookup-common.dto';
import { ItemCategoriesService } from './item-categories.service';

@ApiTags('catalog')
@ApiCookieAuth()
@Controller('item-categories')
export class ItemCategoriesController {
  constructor(private readonly categories: ItemCategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({
    summary: 'List item categories (codes feed tag/SKU patterns).',
  })
  list(@Query() query: LookupQueryDto) {
    return this.categories.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Create an item category (unique code).' })
  create(
    @Body() dto: CreateItemCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categories.create(dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'Category detail incl. subcategories.' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.getById(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Edit / activate / deactivate a category.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categories.update(id, dto, auditContextFrom(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({
    summary: 'Delete an unreferenced category (409 IN_USE once referenced).',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.categories.remove(id, auditContextFrom(req));
  }

  @Get(':categoryId/subcategories')
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'List subcategories of a category.' })
  listSubcategories(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Query() query: LookupQueryDto,
  ) {
    return this.categories.listSubcategories(categoryId, query);
  }

  @Post(':categoryId/subcategories')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Create a subcategory (code unique per category).' })
  createSubcategory(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: CreateItemCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categories.createSubcategory(
      categoryId,
      dto,
      auditContextFrom(req),
    );
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@Controller('item-subcategories')
export class ItemSubcategoriesController {
  constructor(private readonly categories: ItemCategoriesService) {}

  @Get(':id')
  @RequirePermissions(PERMISSIONS.lookup.view)
  @ApiOperation({ summary: 'Subcategory detail.' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.getSubcategory(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({ summary: 'Edit / activate / deactivate a subcategory.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categories.updateSubcategory(id, dto, auditContextFrom(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.lookup.manage)
  @ApiOperation({
    summary: 'Delete an unreferenced subcategory (409 IN_USE once referenced).',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.categories.removeSubcategory(id, auditContextFrom(req));
  }
}
