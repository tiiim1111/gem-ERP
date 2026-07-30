import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsDecimal,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * PATCH /assets/:id — edits non-lifecycle fields only (status changes go
 * through the action endpoints). Draft assets are fully editable; active
 * assets accept only the always-editable subset (warranty, criticality,
 * next maintenance, notes, serial correction). Requires the current
 * `version` (409 VERSION_CONFLICT on mismatch).
 */
export class UpdateAssetDto {
  @ApiProperty({
    description:
      'Optimistic-concurrency token from the last read of this asset.',
  })
  @IsInt()
  version!: number;

  @ApiPropertyOptional({ description: 'Manufacturer serial number (null clears).' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(128)
  serialNumber?: string | null;

  @ApiPropertyOptional({ description: 'Condition lookup value (draft only).' })
  @IsOptional()
  @IsUUID()
  conditionId?: string;

  @ApiPropertyOptional({ description: 'Criticality/priority lookup value.' })
  @IsOptional()
  @IsUUID()
  criticalityId?: string | null;

  @ApiPropertyOptional({ description: 'Warehouse (draft only).' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Storage location (draft only).' })
  @IsOptional()
  @IsUUID()
  storageLocationId?: string | null;

  @ApiPropertyOptional({ description: 'Department / cost center (draft only).' })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ example: '2026-05-12' })
  @IsOptional()
  @IsDateString()
  acquisitionDate?: string | null;

  @ApiPropertyOptional({ example: '65000.00' })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2' })
  acquisitionCost?: string | null;

  @ApiPropertyOptional({ description: 'Acquisition supplier (draft only).' })
  @IsOptional()
  @IsUUID()
  supplierId?: string | null;

  @ApiPropertyOptional({ example: '2026-05-12' })
  @IsOptional()
  @IsDateString()
  warrantyStartDate?: string | null;

  @ApiPropertyOptional({ example: '2027-05-12' })
  @IsOptional()
  @IsDateString()
  warrantyEndDate?: string | null;

  @ApiPropertyOptional({ description: 'Next scheduled maintenance (ISO date-time).' })
  @IsOptional()
  @IsDateString()
  nextMaintenanceAt?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
