import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({
    example: 'REPORT_VIEWER',
    description: 'Stable uppercase code (immutable after creation).',
  })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, {
    message:
      'code must be uppercase letters, digits, and underscores, starting with a letter',
  })
  code!: string;

  @ApiProperty({ example: 'Report Viewer' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Permission strings from the catalog (e.g. "asset.view").',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}
