import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalApproverType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';
import { PaginationQueryDto } from '../../common/pagination';
import { APPROVAL_RESOURCE_TYPES } from '../approval-rules';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ApprovalStepDto {
  @ApiPropertyOptional({
    description: '1-based order; defaults to the array position.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence?: number;

  @ApiPropertyOptional({ example: 'Branch manager sign-off' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({
    enum: ApprovalApproverType,
    description:
      'How the approver resolves at request time: ROLE (any active holder, branch-scoped) | POSITION (any active employee holding it) | DEPT_HEAD (requester’s department head) | USER (named person).',
  })
  @IsEnum(ApprovalApproverType)
  approverType!: ApprovalApproverType;

  @ApiPropertyOptional({ description: 'Required when approverType = ROLE.' })
  @IsOptional()
  @IsUUID()
  approverRoleId?: string;

  @ApiPropertyOptional({ description: 'Required when approverType = POSITION.' })
  @IsOptional()
  @IsUUID()
  approverPositionId?: string;

  @ApiPropertyOptional({ description: 'Required when approverType = USER.' })
  @IsOptional()
  @IsUUID()
  approverUserId?: string;
}

export class CreateApprovalWorkflowDto {
  @ApiProperty({ example: 'WF-PO-HIGH-VALUE' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/i, {
    message:
      'code may only contain letters, digits, hyphens, and underscores',
  })
  code!: string;

  @ApiProperty({ example: 'High-value purchase orders' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    enum: APPROVAL_RESOURCE_TYPES,
    description: 'Document type this workflow routes.',
  })
  @IsIn(APPROVAL_RESOURCE_TYPES as unknown as string[])
  documentType!: (typeof APPROVAL_RESOURCE_TYPES)[number];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional sub-type scope (e.g. ADJUSTMENT_INCREASE, ADJUSTMENT_DECREASE, INTER_BRANCH). Empty/omitted = every sub-type.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  documentSubtypes?: string[];

  @ApiPropertyOptional({
    description: 'Branch scope; omitted = applies to every branch.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: '10000.00' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'minAmount must be a decimal string' })
  minAmount?: string;

  @ApiPropertyOptional({ example: '999999.00' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'maxAmount must be a decimal string' })
  maxAmount?: string;

  @ApiPropertyOptional({ example: '50' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, { message: 'minQuantity must be a decimal string' })
  minQuantity?: string;

  @ApiPropertyOptional({ example: '10000' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, { message: 'maxQuantity must be a decimal string' })
  maxQuantity?: string;

  @ApiProperty({ type: [ApprovalStepDto], description: 'Ordered steps.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepDto)
  steps!: ApprovalStepDto[];
}

export class UpdateApprovalWorkflowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  documentSubtypes?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'minAmount must be a decimal string' })
  minAmount?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'maxAmount must be a decimal string' })
  maxAmount?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, { message: 'minQuantity must be a decimal string' })
  minQuantity?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(QUANTITY_PATTERN, { message: 'maxQuantity must be a decimal string' })
  maxQuantity?: string | null;

  @ApiPropertyOptional({
    type: [ApprovalStepDto],
    description:
      'Replaces the step list wholesale. Refused (409 IN_USE) while requests are pending on this workflow.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepDto)
  steps?: ApprovalStepDto[];
}

export class QueryApprovalWorkflowsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: APPROVAL_RESOURCE_TYPES })
  @IsOptional()
  @IsIn(APPROVAL_RESOURCE_TYPES as unknown as string[])
  documentType?: (typeof APPROVAL_RESOURCE_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  isActive?: boolean;
}
