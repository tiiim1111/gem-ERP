import { Type } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EXPORT_FORMATS } from '@gemerp/reports';
import { PaginationQueryDto } from '../../common/pagination';

export class CreateExportDto {
  @ApiProperty({ description: 'Registry report key, e.g. "stock-on-hand".' })
  @IsString()
  @MaxLength(64)
  reportKey!: string;

  @ApiProperty({ enum: EXPORT_FORMATS })
  @IsIn([...EXPORT_FORMATS])
  format!: (typeof EXPORT_FORMATS)[number];

  @ApiPropertyOptional({
    description:
      'Report filters (§1.4 keys the report supports). Validated against the registry at enqueue.',
  })
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  filters?: Record<string, string>;
}

export class QueryExportsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Job status filter: queued | processing | completed | failed.',
  })
  @IsOptional()
  @IsIn(['queued', 'processing', 'completed', 'failed'])
  status?: string;
}
