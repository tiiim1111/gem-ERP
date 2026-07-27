import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'jdoe@gemcor.dev' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({
    description:
      'Initial admin-set password; the user must change it at first login.',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ type: [String], description: 'Role IDs to assign.' })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Accessible branch IDs.' })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  branchIds?: string[];
}
