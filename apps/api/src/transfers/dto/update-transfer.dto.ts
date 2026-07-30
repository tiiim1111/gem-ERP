import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferLineDto } from './create-transfer.dto';

/**
 * Draft-only edit (outline 1.6/1.8). Endpoints, kind, and status never change
 * through PATCH; `lines` REPLACES the draft's lines when provided.
 */
export class UpdateTransferDto {
  @ApiProperty({ description: 'Current optimistic-concurrency version.' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: '2026-07-28' })
  @IsOptional()
  @IsISO8601()
  transferDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: [TransferLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines?: TransferLineDto[];
}
