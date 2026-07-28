import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessCategory, TrackingMethod } from '@prisma/client';

const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Draft-editable fields. SKU is a generated business number and is not
 * editable. trackingMethod / businessCategory become immutable once stock or
 * assets exist (409 INVALID_STATE_TRANSITION). Activation is a separate
 * explicit action endpoint.
 */
export class UpdateItemDto {
  @ApiProperty({
    description:
      'Current record version (optimistic concurrency). Mismatch → 409 VERSION_CONFLICT.',
    example: 1,
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({
    enum: BusinessCategory,
    description: 'Immutable once stock or assets exist.',
  })
  @IsOptional()
  @IsEnum(BusinessCategory)
  businessCategory?: BusinessCategory;

  @ApiPropertyOptional({
    enum: TrackingMethod,
    description: 'Immutable once stock or assets exist.',
  })
  @IsOptional()
  @IsEnum(TrackingMethod)
  trackingMethod?: TrackingMethod;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  subcategoryId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  manufacturerId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(150)
  model?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  baseUomId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  purchaseUomId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  issueUomId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  defaultSupplierId?: string | null;

  @ApiPropertyOptional({ example: '65000.00', nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'standardCost must be a decimal string like "1250.00"' })
  standardCost?: string | null;

  @ApiPropertyOptional({ example: '63500.00', nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'lastPurchaseCost must be a decimal string like "1250.00"' })
  lastPurchaseCost?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLotTracked?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isExpiryTracked?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresSerialNumber?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMaintainable?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
