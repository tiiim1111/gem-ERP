import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus, TransferType } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

export class QueryTransfersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransferStatus })
  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  @ApiPropertyOptional({ enum: TransferType })
  @IsOptional()
  @IsEnum(TransferType)
  kind?: TransferType;

  @ApiPropertyOptional({ description: 'Filter by source branch (must be in scope).' })
  @IsOptional()
  @IsUUID()
  sourceBranchId?: string;

  @ApiPropertyOptional({ description: 'Filter by destination branch (must be in scope).' })
  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  @ApiPropertyOptional({ description: 'Exact or partial transfer number.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  number?: string;

  @ApiPropertyOptional({ description: 'transferDate >= from (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'transferDate <= to (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
