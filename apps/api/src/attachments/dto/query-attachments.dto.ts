import { IsIn, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination';
import { ATTACHMENT_RESOURCE_TYPES } from '../attachment-parents';

/**
 * GET /attachments?resourceType=&resourceId= — a record's attachments.
 * Both parameters are mandatory: attachments are only ever listed in the
 * context of their parent (its view-permission + branch scope apply).
 */
export class QueryAttachmentsDto extends PaginationQueryDto {
  @ApiProperty({ enum: ATTACHMENT_RESOURCE_TYPES })
  @IsIn(ATTACHMENT_RESOURCE_TYPES)
  resourceType!: string;

  @ApiProperty({ description: 'ID of the parent record.' })
  @IsUUID()
  resourceId!: string;
}
