import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { StockDocumentStatus } from '@prisma/client';
import {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';
import { PaginationQueryDto } from '../../common/pagination';

export class SupplierReturnLineDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'UOM the quantity is entered in.' })
  @IsUUID()
  uomId!: string;

  @ApiProperty({ example: '3', description: 'Returned quantity (> 0).' })
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity must be a positive decimal with up to 4 decimal places',
  })
  quantity!: string;

  @ApiPropertyOptional({
    description: 'Lot the returned stock comes from (required for LOT items).',
  })
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({
    description:
      'Storage location holding the stock. Auto-resolved when exactly one location holds the item.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    example: '455.00',
    description: 'Cost per entered UOM unit (decimal string).',
  })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'unitCost must be a decimal string like "455.00"',
  })
  unitCost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateSupplierReturnDto {
  @ApiProperty()
  @IsUUID()
  supplierId!: string;

  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty({ description: 'Warehouse the stock leaves from.' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({
    description: 'Goods receipt that delivered the stock being returned.',
  })
  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;

  @ApiPropertyOptional({
    example: '2026-08-05',
    description: 'Return date. Defaults to today (UTC).',
  })
  @IsOptional()
  @IsISO8601()
  returnDate?: string;

  @ApiPropertyOptional({
    description:
      'Reason lookup value id (RETURN_REASON / ADJUSTMENT_REASON / TRANSACTION_REASON).',
  })
  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [SupplierReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SupplierReturnLineDto)
  lines!: SupplierReturnLineDto[];
}

export class UpdateSupplierReturnDto {
  @ApiProperty({ description: 'Current version (optimistic concurrency).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  returnDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reasonId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    type: [SupplierReturnLineDto],
    description: 'Replaces the draft lines wholesale when provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SupplierReturnLineDto)
  lines?: SupplierReturnLineDto[];
}

export class QuerySupplierReturnsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StockDocumentStatus })
  @IsOptional()
  @IsEnum(StockDocumentStatus)
  status?: StockDocumentStatus;

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
  goodsReceiptId?: string;

  @ApiPropertyOptional({ description: 'Return date from (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Return date to (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ApproveSupplierReturnDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class CancelSupplierReturnDto {
  @ApiProperty({ description: 'Cancellation reason (mandatory).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class PostSupplierReturnDto {
  @ApiPropertyOptional({
    description:
      'Allow returning stock from expired lots (returning expired goods to the supplier is a normal flow).',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  allowExpiredLots?: boolean;
}
