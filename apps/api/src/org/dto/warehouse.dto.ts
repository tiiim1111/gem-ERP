import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const toUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateWarehouseDto {
  @ApiProperty({ example: 'WH1', description: 'Unique per branch.' })
  @Transform(toUpper)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, {
    message:
      'code must be 1-16 uppercase letters, digits, underscores, or hyphens',
  })
  code!: string;

  @ApiProperty({ example: 'Main Warehouse' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateWarehouseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Default receiving location ID (null clears it).',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  defaultReceivingLocationId?: string | null;

  @ApiPropertyOptional({
    description: 'Default issuance location ID (null clears it).',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  defaultIssueLocationId?: string | null;
}
