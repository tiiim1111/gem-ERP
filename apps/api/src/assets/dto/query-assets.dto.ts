import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AssetLifecycleStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

/** GET /assets — branch-scoped list filters (api-outline 4.3). */
export class QueryAssetsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Free-text search on asset tag, serial number, or item name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Restrict to one branch (must be in scope).' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: AssetLifecycleStatus })
  @IsOptional()
  @IsEnum(AssetLifecycleStatus)
  status?: AssetLifecycleStatus;

  @ApiPropertyOptional({ description: 'Condition lookup value id.' })
  @IsOptional()
  @IsUUID()
  conditionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Item category id.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Current custodian employee id.' })
  @IsOptional()
  @IsUUID()
  custodianEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Department / cost center id.' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({
    description:
      'Only assets whose warranty expires within the next N days (1-3650).',
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  warrantyExpiringDays?: number;
}
