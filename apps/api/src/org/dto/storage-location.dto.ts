import { Transform } from 'class-transformer';
import {
  IsBoolean,
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
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const toUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateStorageLocationDto {
  @ApiProperty({ example: 'A01', description: 'Unique per warehouse.' })
  @Transform(toUpper)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, {
    message:
      'code must be 1-16 uppercase letters, digits, underscores, or hyphens',
  })
  code!: string;

  @ApiProperty({ example: 'Aisle A, Shelf 01' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'Parent location for nesting.' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    example: 'SHELF',
    description: 'Zone / aisle / rack / shelf / bin classification.',
  })
  @IsOptional()
  @Transform(toUpper)
  @IsString()
  @MaxLength(30)
  locationType?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateStorageLocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toUpper)
  @IsString()
  @MaxLength(30)
  locationType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}
