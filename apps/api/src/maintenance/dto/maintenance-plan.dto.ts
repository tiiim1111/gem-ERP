import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';
import { PaginationQueryDto } from '../../common/pagination';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class PlanTaskDto {
  @ApiProperty({ example: 'Clean fans and heatsink' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}

export class CreateMaintenancePlanDto {
  @ApiPropertyOptional({
    description: 'Business code. Auto-generated (MPL-{SEQ5}) when omitted.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, {
    message:
      'code must be 2-30 chars: uppercase letters, digits, "-" or "_", starting alphanumeric',
  })
  code?: string;

  @ApiProperty({ example: 'Laptop preventive service' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ description: 'MAINTENANCE_TYPE lookup value.' })
  @IsUUID()
  maintenanceTypeId!: string;

  @ApiPropertyOptional({
    description: 'Frequency: every N days. One frequency mechanism required.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  intervalDays?: number;

  @ApiPropertyOptional({
    example: '250',
    description: 'Frequency: usage-meter interval (e.g. runtime hours).',
  })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'meterInterval must be a positive decimal (up to 4 dp)',
  })
  meterInterval?: string;

  @ApiPropertyOptional({ example: 'RUNTIME_HOURS' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  meterType?: string;

  @ApiPropertyOptional({
    example: '0 0 1 * *',
    description:
      'Frequency: cron-style schedule (stored verbatim; nextDueAt must be supplied explicitly for cron plans).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scheduleCron?: string;

  @ApiPropertyOptional({ example: 'IT Support' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedTeam?: string;

  @ApiPropertyOptional({ description: 'External vendor (supplier).' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ example: '1.5' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'estimatedDurationHours must be a positive decimal',
  })
  estimatedDurationHours?: string;

  @ApiPropertyOptional({ example: '1500.00' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'estimatedCost must be a decimal string like "1500.00"',
  })
  estimatedCost?: string;

  @ApiPropertyOptional({ description: 'Days before due to start reminding.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  reminderLeadDays?: number;

  @ApiPropertyOptional({
    description:
      'Explicit first due date. Defaults to now + intervalDays for interval plans.',
  })
  @IsOptional()
  @IsISO8601()
  nextDueAt?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Assets this plan covers (replaceable via PUT :id/assets).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  assetIds?: string[];

  @ApiPropertyOptional({ type: [PlanTaskDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PlanTaskDto)
  tasks?: PlanTaskDto[];
}

export class UpdateMaintenancePlanDto {
  @ApiProperty({ description: 'Current version (optimistic concurrency).' })
  @Type(() => Number)
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
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  maintenanceTypeId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  intervalDays?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'meterInterval must be a positive decimal (up to 4 dp)',
  })
  meterInterval?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  meterType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scheduleCron?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedTeam?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'estimatedDurationHours must be a positive decimal',
  })
  estimatedDurationHours?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'estimatedCost must be a decimal string like "1500.00"',
  })
  estimatedCost?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  reminderLeadDays?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsISO8601()
  nextDueAt?: string | null;

  @ApiPropertyOptional({
    type: [PlanTaskDto],
    description: 'Replaces the checklist wholesale when provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PlanTaskDto)
  tasks?: PlanTaskDto[];
}

export class QueryMaintenancePlansDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search on code/name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Plans covering this asset.' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional({ description: 'nextDueAt on or before (inclusive).' })
  @IsOptional()
  @IsISO8601()
  dueBefore?: string;
}

export class ReplacePlanAssetsDto {
  @ApiProperty({
    type: [String],
    description: 'The full covered-asset set (replaces the existing set).',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  assetIds!: string[];
}
