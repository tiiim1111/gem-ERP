import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsDecimal,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * POST /assets — register one or more asset instances of a SERIAL-tracked
 * item. Asset tags (AST-{BRANCH}-{CAT}-{YYYY}-{SEQ6}) and scan tokens are
 * generated server-side, atomically with the insert. PO-sourced assets are
 * created by goods-receipt posting instead (Phase 4).
 */
export class RegisterAssetDto {
  @ApiProperty({ description: 'Item Master entry (must be SERIAL-tracked).' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'Owning branch (must be in caller scope).' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ description: 'Warehouse holding the asset.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Storage location within the warehouse.' })
  @IsOptional()
  @IsUUID()
  storageLocationId?: string;

  @ApiPropertyOptional({
    description:
      'Number of instances to register in one call (bulk). Default 1, max 100.',
    default: 1,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'Manufacturer serial number (single registration). Unique per item while the asset exists.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  serialNumber?: string;

  @ApiPropertyOptional({
    description:
      'Manufacturer serial numbers for bulk registration — length must equal `quantity` when provided.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  serialNumbers?: string[];

  @ApiPropertyOptional({
    description: 'Condition lookup value (asset-conditions).',
  })
  @IsOptional()
  @IsUUID()
  conditionId?: string;

  @ApiPropertyOptional({ description: 'Criticality/priority lookup value.' })
  @IsOptional()
  @IsUUID()
  criticalityId?: string;

  @ApiPropertyOptional({ description: 'Department / cost center.' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ example: '2026-05-12', description: 'ISO date.' })
  @IsOptional()
  @IsDateString()
  acquisitionDate?: string;

  @ApiPropertyOptional({
    description:
      'Acquisition cost as a decimal string ("65000.00"). Visible only with asset.view_cost.',
    example: '65000.00',
  })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2' })
  acquisitionCost?: string;

  @ApiPropertyOptional({ description: 'Acquisition supplier.' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: '2026-05-12', description: 'ISO date.' })
  @IsOptional()
  @IsDateString()
  warrantyStartDate?: string;

  @ApiPropertyOptional({ example: '2027-05-12', description: 'ISO date.' })
  @IsOptional()
  @IsDateString()
  warrantyEndDate?: string;

  @ApiPropertyOptional({ description: 'Next scheduled maintenance (ISO date-time).' })
  @IsOptional()
  @IsDateString()
  nextMaintenanceAt?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Initial lifecycle status. AVAILABLE applies the activation checks (warehouse + condition set).',
    enum: ['DRAFT', 'AVAILABLE'],
    default: 'DRAFT',
  })
  @IsOptional()
  @IsIn(['DRAFT', 'AVAILABLE'])
  initialStatus?: 'DRAFT' | 'AVAILABLE';
}
