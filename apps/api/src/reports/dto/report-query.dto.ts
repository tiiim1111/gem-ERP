import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination';

/**
 * Generic §1.4 report filters. Which keys a given report accepts — and the
 * valid `status` values — is enforced per definition by the report registry
 * (unsupported filters are a VALIDATION_ERROR, never silently ignored).
 */
export class ReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  itemId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Report-specific status value.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @ApiPropertyOptional({ description: 'Date range from (inclusive, YYYY-MM-DD).' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  from?: string;

  @ApiPropertyOptional({ description: 'Date range to (inclusive, YYYY-MM-DD).' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  to?: string;
}

/** Extract only the §1.4 filter keys (drops page/pageSize/sort). */
export function filtersFrom(query: ReportQueryDto): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const key of [
    'branchId',
    'warehouseId',
    'categoryId',
    'itemId',
    'employeeId',
    'departmentId',
    'supplierId',
    'status',
    'from',
    'to',
  ] as const) {
    const value = query[key];
    if (value !== undefined && value !== '') {
      filters[key] = value;
    }
  }
  return filters;
}
