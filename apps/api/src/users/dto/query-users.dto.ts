import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class QueryUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search on email/display name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Only users holding this role.' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Only users with access to this branch.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}
