import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StockDocumentStatus, StockTransactionType } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

export class QueryStockTransactionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StockTransactionType })
  @IsOptional()
  @IsEnum(StockTransactionType)
  type?: StockTransactionType;

  @ApiPropertyOptional({ enum: StockDocumentStatus })
  @IsOptional()
  @IsEnum(StockDocumentStatus)
  status?: StockDocumentStatus;

  @ApiPropertyOptional({ description: 'Filter by branch (must be in scope).' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Matches source or destination warehouse.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Transactions with a line for this item.' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Exact or partial transaction number.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  number?: string;

  @ApiPropertyOptional({ description: 'transactionDate >= from (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'transactionDate <= to (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
