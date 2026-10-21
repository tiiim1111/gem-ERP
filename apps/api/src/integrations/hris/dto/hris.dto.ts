import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueueRunDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Rehearse with zero database writes. Takes the identical decision path as a real run.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;
}

export class QueryRunsDto {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UpdateDepartmentMapDto {
  @ApiProperty({
    nullable: true,
    description:
      'GEM-ENI department id, or null to leave the code unmapped (its employees are then skipped with a visible error rather than filed arbitrarily).',
  })
  @IsOptional()
  @IsUUID()
  departmentId!: string | null;
}

export class UpdatePositionMapDto {
  @ApiProperty({ nullable: true, description: 'GEM-ENI position id, or null to unmap.' })
  @IsOptional()
  @IsUUID()
  positionId!: string | null;
}
