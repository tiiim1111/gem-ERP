import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ATTACHMENT_RESOURCE_TYPES } from '../attachment-parents';

/**
 * Multipart body of POST /attachments (the file itself rides in the `file`
 * part). Requires the update-permission of the parent record plus its branch
 * scope (api-outline §4.6).
 */
export class UploadAttachmentDto {
  @ApiProperty({
    enum: ATTACHMENT_RESOURCE_TYPES,
    description: 'Type of the record this file belongs to.',
  })
  @IsIn(ATTACHMENT_RESOURCE_TYPES)
  resourceType!: string;

  @ApiProperty({ description: 'ID of the parent record.' })
  @IsUUID()
  resourceId!: string;

  @ApiPropertyOptional({
    description:
      'DOCUMENT_TYPE lookup value classifying the file (delivery receipt, warranty card, photo, ...).',
  })
  @IsOptional()
  @IsUUID()
  documentTypeId?: string;
}
