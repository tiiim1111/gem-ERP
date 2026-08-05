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
import { GoodsReceiptStatus } from '@prisma/client';
import { LotInputDto } from '../../inventory/dto/create-stock-transaction.dto';
import {
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';
import { PaginationQueryDto } from '../../common/pagination';

export class GoodsReceiptLineDto {
  @ApiProperty({ description: 'Purchase order line this receipt line fulfills.' })
  @IsUUID()
  poLineId!: string;

  @ApiProperty({
    example: '2',
    description:
      'Received quantity, entered in the PO line UOM (> 0). SERIAL items must use whole numbers.',
  })
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity must be a positive decimal with up to 4 decimal places',
  })
  quantity!: string;

  @ApiPropertyOptional({
    description:
      'UOM of the entered quantity. Must equal the PO line UOM (defaults to it when omitted).',
  })
  @IsOptional()
  @IsUUID()
  uomId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Manufacturer serial numbers for SERIAL items — exactly one per received unit.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  serials?: string[];

  @ApiPropertyOptional({
    description: 'Existing lot to extend (LOT items).',
  })
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({
    type: LotInputDto,
    description: 'Inline lot creation for LOT items (alternative to lotId).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LotInputDto)
  lotInput?: LotInputDto;

  @ApiPropertyOptional({
    description:
      'Destination storage location in the receipt warehouse. Defaults to the warehouse receiving location.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateGoodsReceiptDto {
  @ApiProperty({ description: 'Approved (or partially received) PO.' })
  @IsUUID()
  purchaseOrderId!: string;

  @ApiPropertyOptional({
    example: '2026-08-05',
    description: 'Received date. Defaults to today (UTC).',
  })
  @IsOptional()
  @IsISO8601()
  receivedDate?: string;

  @ApiPropertyOptional({
    description: 'Supplier delivery receipt / invoice reference.',
    example: 'DR-8842 / SI-0913',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [GoodsReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];
}

export class UpdateGoodsReceiptDto {
  @ApiProperty({ description: 'Current version (optimistic concurrency).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  receivedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierReference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    type: [GoodsReceiptLineDto],
    description: 'Replaces the draft lines wholesale when provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines?: GoodsReceiptLineDto[];
}

export class QueryGoodsReceiptsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GoodsReceiptStatus })
  @IsOptional()
  @IsEnum(GoodsReceiptStatus)
  status?: GoodsReceiptStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Receipt number contains (case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  number?: string;

  @ApiPropertyOptional({ description: 'Receipt date from (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Receipt date to (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class CancelGoodsReceiptDto {
  @ApiProperty({ description: 'Cancellation reason (mandatory).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class ReverseGoodsReceiptDto {
  @ApiProperty({ description: 'Reversal reason (mandatory).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
