import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateApprovalDelegationDto {
  @ApiProperty({ description: 'User who may act on the caller’s behalf.' })
  @IsUUID()
  delegateUserId!: string;

  @ApiProperty({ example: '2026-08-10T00:00:00.000Z' })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({ example: '2026-08-20T23:59:59.000Z' })
  @IsISO8601()
  endsAt!: string;

  @ApiPropertyOptional({ example: 'Annual leave' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class QueryApprovalDelegationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'true = every delegation (needs approval.manage); default = only delegations the caller gave or received.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  all?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Filter on the active flag.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}
