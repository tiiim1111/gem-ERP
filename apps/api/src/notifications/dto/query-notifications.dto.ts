import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class QueryNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'true = only read, false = only unread; omitted = all.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  read?: boolean;

  @ApiPropertyOptional({
    description: 'Machine type code (e.g. LOW_STOCK, APPROVAL_PENDING).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;
}
