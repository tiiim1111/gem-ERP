import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const toUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateEmployeeDto {
  @ApiPropertyOptional({
    description:
      'Business employee number (EMP-{SEQ}). Generated from sequence_counters when omitted.',
    example: 'EMP-000123',
  })
  @IsOptional()
  @Transform(toUpper)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, {
    message:
      'employeeNumber must be 1-32 uppercase letters, digits, underscores, or hyphens',
  })
  employeeNumber?: string;

  @ApiProperty({ example: 'Maria' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @ApiProperty({ example: 'Santos' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ description: 'Preferred/display name.' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  displayName?: string;

  @ApiPropertyOptional({ example: 'maria.santos@gemcor.dev' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  workEmail?: string;

  @ApiPropertyOptional({ description: 'Work phone or extension.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  workPhone?: string;

  @ApiProperty({ description: 'Owning branch (must be in caller scope).' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiPropertyOptional({ description: 'Immediate supervisor (employee ID).' })
  @IsOptional()
  @IsUUID()
  supervisorId?: string;

  @ApiPropertyOptional({ example: '2026-01-15', description: 'ISO date.' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @ApiPropertyOptional({
    description: 'Restricted notes — visible only with employee.view_notes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Optional system user account to link (one-to-one).',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
