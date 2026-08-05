import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';
import { PaginationQueryDto } from '../../common/pagination';

export class CreateMeterReadingDto {
  @ApiProperty({ example: '1250.5', description: 'Meter value (up to 4 dp).' })
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'readingValue must be a non-negative decimal (up to 4 dp)',
  })
  readingValue!: string;

  @ApiPropertyOptional({ example: 'RUNTIME_HOURS' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  meterType?: string;

  @ApiPropertyOptional({ description: 'Defaults to now (UTC).' })
  @IsOptional()
  @IsISO8601()
  readingAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class QueryMeterReadingsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'RUNTIME_HOURS' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  meterType?: string;

  @ApiPropertyOptional({ description: 'readingAt from (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'readingAt to (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
