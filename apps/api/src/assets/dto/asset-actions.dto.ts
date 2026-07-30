import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Bodies for the lifecycle action endpoints (docs/status-transitions.md §1).
 * Cross-field rules (exactly-one-target, reason-required-per-event, …) are
 * enforced in the service so the errors carry precise messages.
 */

/** POST /assets/:id/assign — employee, department, location, or project. */
export class AssignAssetDto {
  @ApiPropertyOptional({ description: 'Custodian employee (active).' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Assign to a department/cost center.' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Assign to a storage location.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Free-form project reference.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  projectRef?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'ISO date.' })
  @IsOptional()
  @IsDateString()
  expectedReturnDate?: string;

  @ApiProperty({ description: 'Condition at issuance (asset-conditions lookup).' })
  @IsUUID()
  conditionId!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** POST /assets/:id/acknowledge */
export class AcknowledgeAssetDto {
  @ApiPropertyOptional({
    description:
      'Notes for a captured (paper/verbal) acknowledgment recorded by an authorized user on the employee’s behalf. Required when the caller is not the custodian.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** POST /assets/:id/return */
export class ReturnAssetDto {
  @ApiProperty({ description: 'Condition at return (asset-conditions lookup).' })
  @IsUUID()
  conditionId!: string;

  @ApiPropertyOptional({
    description:
      'Force the damaged outcome. Defaults to true when the condition value is DEFECTIVE.',
  })
  @IsOptional()
  @IsBoolean()
  damaged?: boolean;

  @ApiPropertyOptional({ description: 'Return-to warehouse (defaults to current).' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Return-to storage location.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Required when the return is damaged.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * POST /assets/:id/transfer — employee-to-employee reassignment
 * (`employeeId`) OR a direct location/warehouse/branch move. Inter-branch
 * moves of stock follow transfer documents; this endpoint covers custody
 * reassignment and administrative asset relocation with full movement history.
 */
export class TransferAssetDto {
  @ApiPropertyOptional({ description: 'New custodian employee (reassignment).' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Destination branch (must be in scope).' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Destination warehouse.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Destination storage location.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Condition at hand-over (reassignment).',
  })
  @IsOptional()
  @IsUUID()
  conditionId?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'ISO date.' })
  @IsOptional()
  @IsDateString()
  expectedReturnDate?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** POST /assets/:id/inspect — record the inspection outcome. */
export class InspectAssetDto {
  @ApiProperty({ enum: ['PASS', 'FAIL'] })
  @IsIn(['PASS', 'FAIL'])
  outcome!: 'PASS' | 'FAIL';

  @ApiProperty({ description: 'Condition found (asset-conditions lookup).' })
  @IsUUID()
  conditionId!: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Findings — required when the inspection fails.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Flag the asset as needing maintenance.' })
  @IsOptional()
  @IsBoolean()
  maintenanceRequired?: boolean;
}

/** POST /assets/:id/send-to-inspection and /send-to-maintenance */
export class StatusNoteDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** POST /assets/:id/complete-maintenance — outcome chosen explicitly (spec §18). */
export class CompleteMaintenanceDto {
  @ApiProperty({ enum: ['AVAILABLE', 'ASSIGNED', 'DAMAGED', 'RETIRED'] })
  @IsIn(['AVAILABLE', 'ASSIGNED', 'DAMAGED', 'RETIRED'])
  outcome!: 'AVAILABLE' | 'ASSIGNED' | 'DAMAGED' | 'RETIRED';

  @ApiPropertyOptional({ description: 'Final condition (asset-conditions lookup).' })
  @IsOptional()
  @IsUUID()
  conditionId?: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Required for DAMAGED and RETIRED outcomes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/** POST /assets/:id/report-damage and /report-loss */
export class ReportIncidentDto {
  @ApiProperty({ description: 'What happened (mandatory, audited).' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ description: 'Condition found (damage reports).' })
  @IsOptional()
  @IsUUID()
  conditionId?: string;
}

/** POST /assets/:id/recover, /retire, /reverse-disposal */
export class ReasonDto {
  @ApiProperty({ description: 'Reason (mandatory, audited).' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

/** POST /assets/:id/dispose */
export class DisposeAssetDto {
  @ApiProperty({ description: 'Disposal method (disposal-methods lookup).' })
  @IsUUID()
  disposalMethodId!: string;

  @ApiProperty({ description: 'Reason (mandatory, audited).' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}
