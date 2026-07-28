import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessCategory, TrackingMethod } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class QueryItemsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search on SKU, name, model.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: BusinessCategory })
  @IsOptional()
  @IsEnum(BusinessCategory)
  businessCategory?: BusinessCategory;

  @ApiPropertyOptional({ enum: TrackingMethod })
  @IsOptional()
  @IsEnum(TrackingMethod)
  trackingMethod?: TrackingMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Exact match on SKU or any ACTIVE barcode mapping.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  barcode?: string;
}

export class ResolveBarcodeQueryDto {
  @ApiPropertyOptional({ description: 'Scanned code to resolve.' })
  @IsString()
  @MaxLength(128)
  code!: string;
}
