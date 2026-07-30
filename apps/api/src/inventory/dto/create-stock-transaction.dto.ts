import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockTransactionType } from '@prisma/client';
import {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  ToDecimalString,
} from './decimal-string.util';

/** Inline lot creation for receipts of LOT-tracked items (spec §13). */
export class LotInputDto {
  @ApiPropertyOptional({
    description:
      'Explicit lot number. Generated as LOT-{SKU}-{YYYYMMDD}-{SEQ} when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  lotNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierLotNumber?: string;

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsISO8601()
  manufactureDate?: string;

  @ApiPropertyOptional({
    example: '2027-05-01',
    description: 'Required when the item is expiry-tracked.',
  })
  @IsOptional()
  @IsISO8601()
  expiryDate?: string;
}

export class StockTransactionLineDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'UOM the quantity was entered in.' })
  @IsUUID()
  uomId!: string;

  @ApiProperty({
    example: '5',
    description:
      'Entered quantity (> 0, up to 4 decimals). The base quantity is normalized server-side via UOM conversions.',
  })
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity must be a positive decimal with up to 4 decimal places',
  })
  quantity!: string;

  @ApiPropertyOptional({
    description: 'Existing lot (required on issues of LOT-tracked items).',
  })
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({
    description: 'Inline lot creation (receipts of LOT-tracked items only).',
    type: LotInputDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LotInputDto)
  lotInput?: LotInputDto;

  @ApiPropertyOptional({
    description:
      'Storage location the movement touches (source for outbound types, destination for inbound; source side of a LOCATION_TRANSFER).',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Destination location — LOCATION_TRANSFER lines only.',
  })
  @IsOptional()
  @IsUUID()
  destinationLocationId?: string;

  @ApiPropertyOptional({
    example: '240.00',
    description: 'Cost per entered UOM unit (decimal string).',
  })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'unitCost must be a decimal string like "240.00"',
  })
  unitCost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateStockTransactionDto {
  @ApiProperty({
    enum: StockTransactionType,
    description:
      'INTER_BRANCH_TRANSFER_* and REVERSAL are system-generated and cannot be created directly.',
  })
  @IsEnum(StockTransactionType)
  type!: StockTransactionType;

  @ApiPropertyOptional({
    example: '2026-07-28',
    description: 'Business date. Defaults to today (UTC).',
  })
  @IsOptional()
  @IsISO8601()
  transactionDate?: string;

  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty({
    description:
      'Warehouse the movement acts on (source for outbound types, destination for inbound, source side of a LOCATION_TRANSFER).',
  })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({
    description:
      'Destination warehouse for warehouse-to-warehouse LOCATION_TRANSFER (same branch). Defaults to warehouseId.',
  })
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string;

  @ApiPropertyOptional({ description: 'Required for ISSUE_TO_EMPLOYEE / RETURN_FROM_EMPLOYEE.' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Required for ISSUE_TO_DEPARTMENT.' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Required for RETURN_TO_SUPPLIER.' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Maintenance work order (MAINTENANCE_ISSUE).' })
  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  projectRef?: string;

  @ApiPropertyOptional({ description: 'Reason lookup value id.' })
  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @ApiPropertyOptional({
    description:
      'Reason lookup code (TRANSACTION_REASON / ADJUSTMENT_REASON / DISPOSAL_METHOD), alternative to reasonId.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [StockTransactionLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransactionLineDto)
  lines!: StockTransactionLineDto[];
}
