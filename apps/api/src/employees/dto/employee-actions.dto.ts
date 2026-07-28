import { IsDateString, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EmployeeStatus } from '@prisma/client';

/** Deactivation sets INACTIVE or SUSPENDED — never SEPARATED (own workflow). */
export class DeactivateEmployeeDto {
  @ApiProperty({ enum: [EmployeeStatus.INACTIVE, EmployeeStatus.SUSPENDED] })
  @IsIn([EmployeeStatus.INACTIVE, EmployeeStatus.SUSPENDED])
  status!: typeof EmployeeStatus.INACTIVE | typeof EmployeeStatus.SUSPENDED;

  @ApiProperty({ description: 'Reason (audit-logged).' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class SeparateEmployeeDto {
  @ApiProperty({ example: '2026-08-31', description: 'ISO separation date.' })
  @IsDateString()
  separationDate!: string;
}
