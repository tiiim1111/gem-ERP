import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';
import { APPROVAL_RESOURCE_TYPES } from '../approval-rules';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class QueryApprovalRequestsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ApprovalStatus })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;

  @ApiPropertyOptional({ enum: APPROVAL_RESOURCE_TYPES })
  @IsOptional()
  @IsIn(APPROVAL_RESOURCE_TYPES as unknown as string[])
  documentType?: (typeof APPROVAL_RESOURCE_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Only requests whose CURRENT step is assigned to the caller — directly or through an active delegation window.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  assignedToMe?: boolean;
}

export class ApproveApprovalRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectApprovalRequestDto {
  @ApiProperty({ description: 'Mandatory rejection comment (spec §19).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment!: string;
}

export class ReturnApprovalRequestDto {
  @ApiProperty({ description: 'Mandatory revision comment (spec §19).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment!: string;
}
