import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessCategory, TrackingMethod } from '@prisma/client';

const toUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Money values travel as decimal strings ("1250.00") per api-outline 1.1. */
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateItemDto {
  @ApiPropertyOptional({
    description:
      'Internal SKU. Generated as SKU-{CATEGORY_CODE}-{SEQ} when omitted (categoryId required in that case).',
    example: 'SKU-LAP-00001',
  })
  @IsOptional()
  @Transform(toUpper)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,63}$/, {
    message:
      'sku must be 1-64 uppercase letters, digits, underscores, or hyphens',
  })
  sku?: string;

  @ApiProperty({ example: 'Dell Latitude 5450 14" Laptop' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: BusinessCategory })
  @IsEnum(BusinessCategory)
  businessCategory!: BusinessCategory;

  @ApiPropertyOptional({
    enum: TrackingMethod,
    description:
      'Defaults per spec §4: SERIALIZED_ASSET→SERIAL, CONSUMABLE→QUANTITY, BULK_NON_CONSUMABLE→QUANTITY.',
  })
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
  subcategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  manufacturerId?: string;

  @ApiPropertyOptional({ example: 'Latitude 5450' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  model?: string;

  @ApiProperty({ description: 'Base (stocking) unit of measure.' })
  @IsUUID()
  baseUomId!: string;

  @ApiPropertyOptional({ description: 'Default purchasing unit.' })
  @IsOptional()
  @IsUUID()
  purchaseUomId?: string;

  @ApiPropertyOptional({ description: 'Default issuance unit.' })
  @IsOptional()
  @IsUUID()
  issueUomId?: string;

  @ApiPropertyOptional({ description: 'Default supplier (Phase 4 data).' })
  @IsOptional()
  @IsUUID()
  defaultSupplierId?: string;

  @ApiPropertyOptional({ example: '65000.00', description: 'Decimal string.' })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'standardCost must be a decimal string like "1250.00"' })
  standardCost?: string;

  @ApiPropertyOptional({ example: '63500.00', description: 'Decimal string.' })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'lastPurchaseCost must be a decimal string like "1250.00"' })
  lastPurchaseCost?: string;

  @ApiPropertyOptional({ description: 'Forced true for LOT tracking.' })
  @IsOptional()
  @IsBoolean()
  isLotTracked?: boolean;

  @ApiPropertyOptional({ description: 'Only valid for LOT-tracked items.' })
  @IsOptional()
  @IsBoolean()
  isExpiryTracked?: boolean;

  @ApiPropertyOptional({ description: 'Defaults to true for SERIAL tracking.' })
  @IsOptional()
  @IsBoolean()
  requiresSerialNumber?: boolean;

  @ApiPropertyOptional({
    description: 'Maintenance applies only to serialized instances (spec §4).',
  })
  @IsOptional()
  @IsBoolean()
  isMaintainable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Optional primary barcode mapping created with the item (409 DUPLICATE_CODE if actively mapped elsewhere).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  primaryBarcode?: string;
}
