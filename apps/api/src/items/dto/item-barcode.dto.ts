import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Alternate barcode kinds (spec §5 consumables). */
export const BARCODE_TYPES = [
  'INTERNAL',
  'UPC',
  'EAN',
  'SUPPLIER',
  'PACKAGING',
] as const;

export class CreateItemBarcodeDto {
  @ApiProperty({ example: '4806534001234' })
  @IsString()
  @Matches(/^[\x21-\x7E]{4,128}$/, {
    message: 'barcode must be 4-128 printable non-space characters',
  })
  barcode!: string;

  @ApiPropertyOptional({ enum: BARCODE_TYPES, default: 'SUPPLIER' })
  @IsOptional()
  @IsIn(BARCODE_TYPES)
  barcodeType?: (typeof BARCODE_TYPES)[number];

  @ApiPropertyOptional({
    description: 'Packaging unit this barcode identifies (e.g. the BOX code).',
  })
  @IsOptional()
  @IsUUID()
  uomId?: string;

  @ApiPropertyOptional({
    description: 'Make this the primary mapping (demotes the current one).',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
