import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ToDecimalString,
} from '../../inventory/dto/decimal-string.util';

/** Receive counts allow zero, unlike movement quantities. */
const COUNT_PATTERN = /^\d{1,10}(\.\d{1,4})?$/;

export class ApproveTransferDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectTransferDto {
  @ApiProperty({ description: 'Rejection comment (mandatory, spec §19).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment!: string;
}

export class CancelTransferDto {
  @ApiProperty({ description: 'Cancellation reason (mandatory, spec §25).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class ReceiveTransferLineDto {
  @ApiProperty({ description: 'Transfer line id being received.' })
  @IsUUID()
  lineId!: string;

  @ApiProperty({
    example: '9',
    description: 'Quantity received in good condition (entered UOM of the line).',
  })
  @ToDecimalString()
  @IsString()
  @Matches(COUNT_PATTERN, { message: 'received must be a non-negative decimal' })
  received!: string;

  @ApiPropertyOptional({ example: '1', default: '0' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(COUNT_PATTERN, { message: 'damaged must be a non-negative decimal' })
  damaged?: string;

  @ApiPropertyOptional({ example: '0', default: '0' })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(COUNT_PATTERN, { message: 'short must be a non-negative decimal' })
  short?: string;

  @ApiPropertyOptional({
    default: '0',
    description:
      'Rejected-and-returned quantities are not supported yet (return-transfer flow arrives with Phase 6 approvals) — must be 0.',
  })
  @IsOptional()
  @ToDecimalString()
  @IsString()
  @Matches(COUNT_PATTERN, { message: 'rejected must be a non-negative decimal' })
  rejected?: string;

  @ApiPropertyOptional({ description: 'Condition lookup (ASSET_CONDITION).' })
  @IsOptional()
  @IsUUID()
  conditionId?: string;

  @ApiPropertyOptional({
    description: 'Required when damaged or short is non-zero (spec §25).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ReceiveTransferDto {
  @ApiProperty({ type: [ReceiveTransferLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferLineDto)
  lines!: ReceiveTransferLineDto[];

  @ApiPropertyOptional({
    description:
      'Storage location for damaged-in-transit stock (defaults to the destination location).',
  })
  @IsOptional()
  @IsUUID()
  damagedLocationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
