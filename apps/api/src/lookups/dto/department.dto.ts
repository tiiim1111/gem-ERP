import { IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateCodeNameDto, UpdateCodeNameDto } from './lookup-common.dto';

export class CreateDepartmentDto extends CreateCodeNameDto {
  @ApiPropertyOptional({ description: 'Optional branch scope (global when omitted).' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Department head — approver for DEPT_HEAD approval steps.',
  })
  @IsOptional()
  @IsUUID()
  headEmployeeId?: string;
}

export class UpdateDepartmentDto extends UpdateCodeNameDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({
    description: 'Assign/clear the department head (null clears).',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  headEmployeeId?: string | null;
}
