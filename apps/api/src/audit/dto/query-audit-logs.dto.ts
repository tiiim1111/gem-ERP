import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination';

export class QueryAuditLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by acting user ID.' })
  @IsOptional()
  @IsUUID()
  actor?: string;

  @ApiPropertyOptional({
    description: 'Filter by action (substring match, e.g. "auth." or "user.created").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  resourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  resourceId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one branch (must be accessible).' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Inclusive ISO-8601 lower bound.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive ISO-8601 upper bound.' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
