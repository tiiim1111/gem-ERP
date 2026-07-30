import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StockTransactionType } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : value;

export class QueryStockBalancesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by branch (must be in scope).' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({
    description: 'Only rows with non-zero on-hand or in-transit quantity.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  nonZeroOnly?: boolean;
}

export class QueryStockLedgerDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Filter by branch (must be in scope).' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({ enum: StockTransactionType, description: 'Transaction type.' })
  @IsOptional()
  @IsEnum(StockTransactionType)
  type?: StockTransactionType;

  @ApiPropertyOptional({ description: 'postedAt >= from (inclusive, ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'postedAt <= to (inclusive, ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class QueryLotsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    description: 'Only lots with stock in this warehouse (must be in scope).',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'expiryDate strictly before this date.' })
  @IsOptional()
  @IsISO8601()
  expiresBefore?: string;

  @ApiPropertyOptional({
    description: 'Lots expiring within N days from today (0 = already expired).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  expiringWithinDays?: number;

  @ApiPropertyOptional({ description: 'Filter active/inactive lots.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'FEFO ordering: earliest expiry first (nulls last). Overrides sort.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  fefo?: boolean;
}

export class QueryLowStockDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by branch (must be in scope).' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
