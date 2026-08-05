import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
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
import { PurchaseOrderStatus } from '@prisma/client';
import {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';
import { PaginationQueryDto } from '../../common/pagination';

export class PurchaseOrderLineDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'UOM the quantity/price are entered in.' })
  @IsUUID()
  uomId!: string;

  @ApiProperty({ example: '5', description: 'Ordered quantity (> 0).' })
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity must be a positive decimal with up to 4 decimal places',
  })
  quantity!: string;

  @ApiProperty({
    example: '65000.00',
    description: 'Price per entered UOM unit (>= 0, decimal string).',
  })
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'unitPrice must be a decimal string like "65000.00"',
  })
  unitPrice!: string;

  @ApiPropertyOptional({
    example: '500.00',
    description: 'Absolute line discount (must not exceed qty × price).',
  })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'discount must be a decimal string like "500.00"',
  })
  discount?: string;

  @ApiPropertyOptional({
    example: '780.00',
    description: 'Absolute line tax amount.',
  })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'tax must be a decimal string like "780.00"',
  })
  tax?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreatePurchaseOrderDto {
  @ApiProperty()
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ description: 'Ordering branch (branch-scoped).' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ description: 'Destination warehouse (must belong to branchId).' })
  @IsUUID()
  destinationWarehouseId!: string;

  @ApiPropertyOptional({
    example: '2026-08-04',
    description: 'Order date. Defaults to today (UTC).',
  })
  @IsOptional()
  @IsISO8601()
  orderDate?: string;

  @ApiPropertyOptional({ example: '2026-08-18' })
  @IsOptional()
  @IsISO8601()
  expectedDate?: string;

  @ApiPropertyOptional({ default: 'PHP' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [PurchaseOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderDto {
  @ApiProperty({ description: 'Current version (optimistic concurrency).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  orderDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsISO8601()
  expectedDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    type: [PurchaseOrderLineDto],
    description: 'Replaces the draft lines wholesale when provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines?: PurchaseOrderLineDto[];
}

export class QueryPurchaseOrdersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PurchaseOrderStatus })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'PO number contains (case-insensitive).' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  number?: string;

  @ApiPropertyOptional({ description: 'Order date from (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Order date to (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ApprovePurchaseOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectPurchaseOrderDto {
  @ApiProperty({ description: 'Rejection comment (mandatory, spec §19).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment!: string;
}

export class CancelPurchaseOrderDto {
  @ApiProperty({ description: 'Cancellation reason (mandatory).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class ClosePurchaseOrderDto {
  @ApiProperty({
    description:
      'Why the outstanding quantities will not arrive (close-short reason).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
