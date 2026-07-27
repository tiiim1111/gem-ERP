import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class OrgQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search on code/name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class StorageLocationQueryDto extends OrgQueryDto {
  @ApiPropertyOptional({ description: 'Only children of this location.' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
