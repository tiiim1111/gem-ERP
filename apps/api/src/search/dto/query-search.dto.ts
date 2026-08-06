import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SEARCH_ENTITY_TYPES } from '../search-entities';

/**
 * GET /search — global search (api-outline §4.7). `q` matches asset tags,
 * serial numbers, SKUs/names, barcodes, employees, suppliers, and document
 * numbers (PO/GR/WO/transfer/stock transaction). Results are bounded per
 * entity type and filtered by the caller's permissions and branches.
 */
export class QuerySearchDto {
  @ApiProperty({ minLength: 2, maxLength: 100, description: 'Search text.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({
    enum: SEARCH_ENTITY_TYPES,
    description: 'Restrict to one entity type.',
  })
  @IsOptional()
  @IsIn(SEARCH_ENTITY_TYPES)
  type?: string;

  @ApiPropertyOptional({
    default: 5,
    minimum: 1,
    maximum: 20,
    description: 'Maximum results PER entity type.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}
