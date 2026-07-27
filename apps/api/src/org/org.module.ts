import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { StorageLocationsController } from './storage-locations.controller';
import { StorageLocationsService } from './storage-locations.service';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Module({
  controllers: [
    BranchesController,
    WarehousesController,
    StorageLocationsController,
  ],
  providers: [BranchesService, WarehousesService, StorageLocationsService],
})
export class OrgModule {}
