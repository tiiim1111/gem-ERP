import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AppException } from '../common/errors/app.exception';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import {
  AttachmentsService,
  AttachmentView,
  MAX_ATTACHMENT_BYTES,
} from './attachments.service';
import { QueryAttachmentsDto } from './dto/query-attachments.dto';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';

/**
 * Generic attachments (api-outline §4.6). The attachment.* permissions gate
 * the surface; the service ALWAYS re-authorizes against the parent record
 * (view/update permission of the parent + its branch scope), so holding
 * attachment.upload alone never grants access to someone else's records.
 * DELETE (soft archive) is additionally open to the original uploader.
 */
@ApiTags('attachments')
@ApiCookieAuth()
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.attachment.upload)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        resourceType: { type: 'string' },
        resourceId: { type: 'string', format: 'uuid' },
        documentTypeId: { type: 'string', format: 'uuid' },
      },
      required: ['file', 'resourceType', 'resourceId'],
    },
  })
  @ApiOperation({
    summary:
      'Upload a file for a record (multipart; max 20 MB; documents/spreadsheets/photos). Needs the update-permission of the parent + its branch scope. 503 SERVICE_DISABLED without object storage.',
  })
  upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadAttachmentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<AttachmentView> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw AppException.validation([
        { field: 'file', message: 'A non-empty file upload is required.' },
      ]);
    }
    return this.attachments.upload(
      user,
      dto,
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      },
      auditContextFrom(req),
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.attachment.view)
  @ApiOperation({
    summary:
      "A record's attachments (resourceType + resourceId required). Needs the view-permission of the parent + its branch scope.",
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryAttachmentsDto,
  ): Promise<Paginated<AttachmentView>> {
    return this.attachments.list(user, query);
  }

  @Get(':id/download')
  @RequirePermissions(PERMISSIONS.attachment.view)
  @ApiOperation({
    summary:
      'Stream the file bytes (bucket is never public — downloads always proxy through the API with parent authorization).',
  })
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const download = await this.attachments.download(user, id);
    res.setHeader('Content-Type', download.mimeType);
    res.setHeader('Content-Length', String(download.sizeBytes));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(download.fileName)}"`,
    );
    return new StreamableFile(download.stream);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.attachment.upload)
  @ApiOperation({
    summary:
      'Archive an attachment (soft — bytes and audit history stay). Allowed for the uploader, holders of the parent update-permission, or attachment.archive.',
  })
  async archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.attachments.archive(user, id, auditContextFrom(req));
  }
}
