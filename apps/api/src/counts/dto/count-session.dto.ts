import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryCountStatus, InventoryCountType } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';
import {
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Accepts the contract's lowercase "full" | "cycle" as well as the enum. */
const toCountType = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toUpperCase() : value;

export class CountScopeDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({
    description: 'Omit to count every active warehouse of the branch.',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one storage location.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one item category.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Restrict to selected items (cycle counts).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  itemIds?: string[];
}

export class CreateCountSessionDto {
  @ApiProperty({ enum: InventoryCountType, example: 'CYCLE' })
  @Transform(toCountType)
  @IsEnum(InventoryCountType)
  type!: InventoryCountType;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'Blind count: expected quantities hidden until complete.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  blind?: boolean;

  @ApiProperty({ type: CountScopeDto })
  @ValidateNested()
  @Type(() => CountScopeDto)
  scope!: CountScopeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCountSessionDto {
  @ApiProperty({ description: 'Current version (optimistic concurrency).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ enum: InventoryCountType })
  @IsOptional()
  @Transform(toCountType)
  @IsEnum(InventoryCountType)
  type?: InventoryCountType;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  blind?: boolean;

  @ApiPropertyOptional({ type: CountScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CountScopeDto)
  scope?: CountScopeDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class QueryCountSessionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InventoryCountStatus })
  @IsOptional()
  @IsEnum(InventoryCountStatus)
  status?: InventoryCountStatus;

  @ApiPropertyOptional({ enum: InventoryCountType })
  @IsOptional()
  @Transform(toCountType)
  @IsEnum(InventoryCountType)
  type?: InventoryCountType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Count number contains.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  number?: string;

  @ApiPropertyOptional({ description: 'Created from (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Created to (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

/**
 * One line entry: {countedQty} for quantity lines, or
 * {found, conditionId?, locationConfirmed?} for asset lines (api-outline
 * 7.1 — `condition` travels as the ASSET_CONDITION lookup id).
 */
export class RecordCountDto {
  @ApiPropertyOptional({ example: '11' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message:
      'countedQty must be a non-negative decimal with up to 4 decimal places',
  })
  countedQty?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Asset lines only.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  found?: boolean;

  @ApiPropertyOptional({ description: 'ASSET_CONDITION lookup value id.' })
  @IsOptional()
  @IsUUID()
  conditionId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  locationConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ScanCountDto {
  @ApiProperty({
    example: 'SKU-OFC-00001',
    description: 'Raw scanner input: SKU, alternate barcode, lot, asset tag, or serial.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  code!: string;

  @ApiPropertyOptional({
    example: '1',
    description: 'Quantity to add for item scans (default 1).',
  })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'qty must be a positive decimal with up to 4 decimal places',
  })
  qty?: string;

  @ApiPropertyOptional({
    description:
      'Warehouse for unexpected finds when the session spans multiple warehouses.',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Storage location being counted.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class RecountDto {
  @ApiProperty({ type: [String], description: 'Lines to reopen for recount.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  lineIds!: string[];
}

export class CancelCountSessionDto {
  @ApiProperty({ description: 'Cancellation reason (mandatory).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class CreateCountAdjustmentsDto {
  @ApiPropertyOptional({
    description:
      'ADJUSTMENT_REASON lookup id; defaults to the COUNT_VARIANCE reason.',
  })
  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @ApiPropertyOptional({ example: 'COUNT_VARIANCE' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
