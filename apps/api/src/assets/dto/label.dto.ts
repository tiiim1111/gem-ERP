import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const LABEL_FORMATS = ['svg', 'png'] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];

/** Size presets per docs/barcode-strategy.md §8.2 (300 dpi geometry). */
export const LABEL_SIZES = ['2x1', '3x2'] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

/** GET /assets/:id/label?format=svg|png&size=2x1|3x2 */
export class LabelQueryDto {
  @ApiPropertyOptional({ enum: LABEL_FORMATS, default: 'svg' })
  @IsOptional()
  @IsIn(LABEL_FORMATS)
  format?: LabelFormat;

  @ApiPropertyOptional({
    enum: LABEL_SIZES,
    default: '2x1',
    description: '2x1 = 50.8×25.4 mm thermal, 3x2 = 76.2×50.8 mm thermal.',
  })
  @IsOptional()
  @IsIn(LABEL_SIZES)
  size?: LabelSize;
}

/** POST /assets/labels/batch — one printable HTML sheet for many assets. */
export class BatchLabelsDto {
  @ApiProperty({ type: [String], description: 'Assets to print (max 100).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  assetIds!: string[];

  @ApiPropertyOptional({ enum: LABEL_SIZES, default: '2x1' })
  @IsOptional()
  @IsIn(LABEL_SIZES)
  size?: LabelSize;
}
