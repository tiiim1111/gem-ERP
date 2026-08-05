import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
import { AssetLifecycleStatus, MaintenanceWorkOrderStatus } from '@prisma/client';
import {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';
import { PaginationQueryDto } from '../../common/pagination';
import { HOLD_REASONS, HoldReason } from '../work-order-rules';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** The explicit completion outcomes of spec §18 / status-transitions §1.1. */
export const COMPLETION_OUTCOMES = [
  AssetLifecycleStatus.AVAILABLE,
  AssetLifecycleStatus.ASSIGNED,
  AssetLifecycleStatus.DAMAGED,
  AssetLifecycleStatus.RETIRED,
] as const;
export type CompletionOutcome = (typeof COMPLETION_OUTCOMES)[number];

export class CreateWorkOrderDto {
  @ApiProperty({ description: 'Serialized asset the work order services.' })
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'MAINTENANCE_TYPE lookup value.' })
  @IsUUID()
  typeId!: string;

  @ApiPropertyOptional({ description: 'MAINTENANCE_PRIORITY lookup value.' })
  @IsOptional()
  @IsUUID()
  priorityId?: string;

  @ApiProperty({ example: 'Fan noise and thermal shutdowns under load.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  problem!: string;

  @ApiPropertyOptional({ description: 'User who reported the problem.' })
  @IsOptional()
  @IsUUID()
  reportedById?: string;

  @ApiPropertyOptional({ description: 'Preventive plan this WO fulfills.' })
  @IsOptional()
  @IsUUID()
  planId?: string;
}

export class UpdateWorkOrderDto {
  @ApiProperty({ description: 'Current version (optimistic concurrency).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  problem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  typeId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  priorityId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  diagnosis?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  actionTaken?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolution?: string | null;
}

export class QueryWorkOrdersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MaintenanceWorkOrderStatus })
  @IsOptional()
  @IsEnum(MaintenanceWorkOrderStatus)
  status?: MaintenanceWorkOrderStatus;

  @ApiPropertyOptional({ description: 'MAINTENANCE_TYPE lookup value id.' })
  @IsOptional()
  @IsUUID()
  typeId?: string;

  @ApiPropertyOptional({ description: 'MAINTENANCE_PRIORITY lookup value id.' })
  @IsOptional()
  @IsUUID()
  priorityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Only WOs whose assigned technician is the caller.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  assignedToMe?: boolean;

  @ApiPropertyOptional({
    description:
      'Open WOs whose planned window ends (or starts, when no end is set) on or before this date.',
  })
  @IsOptional()
  @IsISO8601()
  dueBefore?: string;

  @ApiPropertyOptional({ description: 'Created from (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Created to (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'WO number contains (case-insensitive).' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  number?: string;
}

export class AssignWorkOrderDto {
  @ApiPropertyOptional({
    description:
      'Technician by user account (resolved to the linked employee record).',
  })
  @IsOptional()
  @IsUUID()
  technicianUserId?: string;

  @ApiPropertyOptional({ description: 'Technician by employee record.' })
  @IsOptional()
  @IsUUID()
  technicianEmployeeId?: string;

  @ApiPropertyOptional({ example: 'Facilities team B' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  team?: string;

  @ApiPropertyOptional({ description: 'External vendor (supplier).' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}

export class ScheduleWorkOrderDto {
  @ApiProperty({ example: '2026-08-10T01:00:00.000Z' })
  @IsISO8601()
  plannedStart!: string;

  @ApiProperty({ example: '2026-08-10T05:00:00.000Z' })
  @IsISO8601()
  plannedEnd!: string;
}

export class HoldWorkOrderDto {
  @ApiProperty({
    enum: HOLD_REASONS,
    description:
      '"On Hold" | "Awaiting Parts" | "Awaiting Vendor" — selects the waiting status.',
  })
  @IsIn(HOLD_REASONS as unknown as string[])
  reason!: HoldReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ResumeWorkOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CompleteWorkOrderDto {
  @ApiProperty({ example: 'Replaced fan; thermal paste renewed.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  resolution!: string;

  @ApiProperty({ example: 'Disassembled, cleaned, replaced CPU fan.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  actionTaken!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  diagnosis?: string;

  @ApiProperty({ description: 'ASSET_CONDITION lookup value (final condition).' })
  @IsUUID()
  finalConditionId!: string;

  @ApiProperty({
    enum: COMPLETION_OUTCOMES,
    description:
      'Explicit asset outcome (spec §18): AVAILABLE | ASSIGNED | DAMAGED | RETIRED.',
  })
  @IsIn(COMPLETION_OUTCOMES as unknown as string[])
  assetNextStatus!: CompletionOutcome;

  @ApiPropertyOptional({
    description: 'Mandatory when the outcome is DAMAGED or RETIRED.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ example: '500.00' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'laborCost must be a decimal string like "500.00"',
  })
  laborCost?: string;

  @ApiPropertyOptional({ example: '0.00' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'externalCost must be a decimal string like "1200.00"',
  })
  externalCost?: string;

  @ApiPropertyOptional({
    description:
      'Downtime in minutes. Defaults to the actual start→completion span.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 365)
  downtimeMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Next maintenance date (preventive WOs). Defaults to completion + plan interval for interval plans.',
  })
  @IsOptional()
  @IsISO8601()
  nextMaintenanceDate?: string;
}

export class VerifyWorkOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class CancelWorkOrderDto {
  @ApiProperty({ description: 'Cancellation reason (mandatory).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class WorkOrderTaskDto {
  @ApiProperty({ example: 'Check charging port' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ReplaceWorkOrderTasksDto {
  @ApiProperty({
    type: [WorkOrderTaskDto],
    description: 'Replaces the checklist wholesale.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WorkOrderTaskDto)
  tasks!: WorkOrderTaskDto[];
}

export class CompleteWorkOrderTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class PartsIssueLineDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'UOM the quantity is entered in.' })
  @IsUUID()
  uomId!: string;

  @ApiProperty({ example: '2' })
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity must be a positive decimal with up to 4 decimal places',
  })
  quantity!: string;

  @ApiPropertyOptional({ description: 'Lot to consume from (FEFO advisory).' })
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({ description: 'Storage location to consume from.' })
  @IsOptional()
  @IsUUID()
  sourceLocationId?: string;

  @ApiPropertyOptional({
    example: '82.00',
    description: 'Unit cost override; defaults to the item last purchase cost.',
  })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'unitCost must be a decimal string like "82.00"',
  })
  unitCost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreatePartsIssueDto {
  @ApiProperty({ description: 'Warehouse the parts are consumed from.' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [PartsIssueLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PartsIssueLineDto)
  lines!: PartsIssueLineDto[];
}
