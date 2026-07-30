import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveStockTransactionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectStockTransactionDto {
  @ApiProperty({ description: 'Rejection comment (mandatory, spec §19).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment!: string;
}

export class CancelStockTransactionDto {
  @ApiProperty({ description: 'Cancellation reason (mandatory, spec §25).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class PostStockTransactionDto {
  @ApiPropertyOptional({
    description:
      'Override the expired-lot block (requires inventory.adjust in addition to inventory.post).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowExpiredLots?: boolean;
}

export class ReverseStockTransactionDto {
  @ApiProperty({ description: 'Reversal reason (mandatory, spec §25).' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({ description: 'Reason lookup value id.' })
  @IsOptional()
  @IsUUID()
  reasonId?: string;
}
