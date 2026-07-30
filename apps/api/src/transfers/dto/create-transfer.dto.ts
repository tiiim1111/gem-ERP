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
import { TransferType } from '@prisma/client';
import {
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';

export class TransferSourceDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ description: 'Required for kind LOCATION.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class TransferDestinationDto {
  @ApiPropertyOptional({
    description: 'Required for INTER_BRANCH; defaults to the source branch otherwise.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description:
      'Required for INTER_BRANCH and INTRA_BRANCH; defaults to the source warehouse for LOCATION.',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Required for kind LOCATION.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class TransferLineDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'UOM the quantity was entered in.' })
  @IsUUID()
  uomId!: string;

  @ApiProperty({ example: '10' })
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity must be a positive decimal with up to 4 decimal places',
  })
  quantity!: string;

  @ApiPropertyOptional({ description: 'Required for LOT-tracked items.' })
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateTransferDto {
  @ApiProperty({
    enum: TransferType,
    description:
      'LOCATION (bin-to-bin), INTRA_BRANCH (warehouse-to-warehouse), INTER_BRANCH (controlled dispatch/receive flow).',
  })
  @IsEnum(TransferType)
  kind!: TransferType;

  @ApiPropertyOptional({ example: '2026-07-28', description: 'Defaults to today.' })
  @IsOptional()
  @IsISO8601()
  transferDate?: string;

  @ApiProperty({ type: TransferSourceDto })
  @ValidateNested()
  @Type(() => TransferSourceDto)
  source!: TransferSourceDto;

  @ApiProperty({ type: TransferDestinationDto })
  @ValidateNested()
  @Type(() => TransferDestinationDto)
  destination!: TransferDestinationDto;

  @ApiProperty({ type: [TransferLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];

  @ApiPropertyOptional({ description: 'Reason lookup value id.' })
  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
