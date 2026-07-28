import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateCodeNameDto, UpdateCodeNameDto } from './lookup-common.dto';

export class CreateUomDto extends CreateCodeNameDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateUomDto extends UpdateCodeNameDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** 1 fromUom = factor × toUom (e.g. 1 BOX = 10 PACK). */
export class CreateUomConversionDto {
  @ApiProperty()
  @IsUUID()
  fromUomId!: string;

  @ApiProperty()
  @IsUUID()
  toUomId!: string;

  @ApiProperty({ example: 10, description: 'Positive factor, up to 4 decimals.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  factor!: number;

  @ApiPropertyOptional({
    description:
      'Item-specific override; omit for a global conversion (api-outline 3.4).',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;
}

export class UpdateUomConversionDto {
  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  factor!: number;
}
