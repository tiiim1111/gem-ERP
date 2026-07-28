import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import {
  ItemCategoriesController,
  ItemSubcategoriesController,
} from './item-categories.controller';
import { ItemCategoriesService } from './item-categories.service';
import { LookupsController } from './lookups.controller';
import { LookupsService } from './lookups.service';
import {
  BrandsController,
  ManufacturersController,
  PositionsController,
} from './simple-catalogs.controller';
import { SimpleCatalogsService } from './simple-catalogs.service';
import { UomConversionsController, UomsController } from './uoms.controller';
import { UomsService } from './uoms.service';

/**
 * Business-managed configuration (spec §10): departments, positions, brands,
 * manufacturers, item categories/subcategories, UOMs + conversions, and the
 * generic /lookups/:type values. Read = lookup.view, write = lookup.manage.
 */
@Module({
  controllers: [
    LookupsController,
    DepartmentsController,
    PositionsController,
    BrandsController,
    ManufacturersController,
    ItemCategoriesController,
    ItemSubcategoriesController,
    UomsController,
    UomConversionsController,
  ],
  providers: [
    LookupsService,
    DepartmentsService,
    SimpleCatalogsService,
    ItemCategoriesService,
    UomsService,
  ],
  exports: [UomsService],
})
export class LookupsModule {}
