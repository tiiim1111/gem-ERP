import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { CreateExportDto, QueryExportsDto } from './dto/export.dto';
import { ExportJobView, ExportsService } from './exports.service';

@ApiTags('exports')
@ApiCookieAuth()
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.report.export)
  @ApiOperation({
    summary:
      'Queue a background export {reportKey, format: csv|xlsx|pdf, filters} → 201 {id, status:"queued"}. report.export + the report\'s underlying permission and branch scope are verified at enqueue; the worker renders and the requester is notified when ready. Audit-logged.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateExportDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ExportJobView> {
    return this.exports.create(user, dto, auditContextFrom(req));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.report.export)
  @ApiOperation({ summary: 'Own export jobs, newest first (filter: status).' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryExportsDto,
  ): Promise<Paginated<ExportJobView>> {
    return this.exports.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.report.export)
  @ApiOperation({
    summary: 'One own export job (another user\'s job is a 404 — owner only).',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExportJobView> {
    return this.exports.getById(user, id);
  }

  @Get(':id/download')
  @RequirePermissions(PERMISSIONS.report.export)
  @ApiOperation({
    summary:
      'Stream the finished file (owner only; 409 while queued/processing/failed). Download is audit-logged.',
  })
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const download = await this.exports.download(user, id, auditContextFrom(req));
    res.setHeader('Content-Type', download.contentType);
    if (download.sizeBytes !== null) {
      res.setHeader('Content-Length', String(download.sizeBytes));
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${download.fileName.replace(/"/g, '')}"`,
    );
    return new StreamableFile(download.stream);
  }
}
