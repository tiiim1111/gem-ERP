import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Per-warehouse stocking rules (reorder level/qty, min/max). PUT semantics:
 * the full setting is replaced; omitted fields are cleared to null.
 */
export class UpsertWarehouseSettingDto {
  @ApiPropertyOptional({ example: 20, description: 'Low-stock threshold.' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  reorderLevel?: number | null;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  reorderQuantity?: number | null;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minQuantity?: number | null;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  maxQuantity?: number | null;

  @ApiPropertyOptional({
    description: 'Default storage location (must belong to the warehouse).',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  defaultStorageLocationId?: string | null;
}
