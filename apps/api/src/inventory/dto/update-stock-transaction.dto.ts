import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockTransactionLineDto } from './create-stock-transaction.dto';

/**
 * Draft-only edit (outline 1.6/1.8): never changes status or type. When
 * `lines` is present it REPLACES the draft's lines wholesale.
 */
export class UpdateStockTransactionDto {
  @ApiProperty({ description: 'Current optimistic-concurrency version.' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: '2026-07-28' })
  @IsOptional()
  @IsISO8601()
  transactionDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  projectRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    type: [StockTransactionLineDto],
    description: 'Full replacement of the draft lines when provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransactionLineDto)
  lines?: StockTransactionLineDto[];
}
