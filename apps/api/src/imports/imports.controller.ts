import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { CommitImportDto } from './dto/commit-import.dto';
import { IMPORT_TYPES } from './import-types';
import {
  CommitResult,
  ImportsService,
  StagingStatusView,
  ValidateResult,
} from './imports.service';

const TYPE_PARAM = {
  name: 'type',
  enum: Object.keys(IMPORT_TYPES),
  description: 'Import type.',
};

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MiB of CSV ≈ tens of thousands of rows

/**
 * Staged imports (spec §24). Permissions are per type (employee.import /
 * item.import / lookup.manage), so the service enforces them dynamically —
 * every route still requires an authenticated session via the global guards.
 *
 * CSV only in Phase 2; XLSX support is deferred to Phase 8 polish.
 */
@ApiTags('imports')
@ApiCookieAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('templates/:type')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiParam(TYPE_PARAM)
  @ApiOperation({ summary: 'Download the CSV template (header + example row).' })
  template(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Res({ passthrough: true }) res: Response,
  ): string {
    const csv = this.imports.templateCsv(user, type);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-template-${type}.csv"`,
    );
    return csv;
  }

  @Post(':type/validate')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiParam(TYPE_PARAM)
  @ApiOperation({
    summary:
      'Parse + validate a CSV upload (no writes): row-level errors, preview, staging ID.',
  })
  validate(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<ValidateResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw AppException.validation([
        { field: 'file', message: 'A non-empty CSV file upload is required.' },
      ]);
    }
    return this.imports.validate(user, type, file.buffer, auditContextFrom(req));
  }

  @Post(':type/commit')
  @HttpCode(200)
  @ApiParam(TYPE_PARAM)
  @ApiOperation({
    summary:
      'Commit a validated staging: strict = all-or-nothing, partial = valid rows only.',
  })
  commit(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Body() dto: CommitImportDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CommitResult> {
    return this.imports.commit(
      user,
      type,
      dto.stagingId,
      dto.mode,
      auditContextFrom(req),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Import staging status, row errors, and commit result.' })
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StagingStatusView> {
    return this.imports.getById(user, id);
  }
}
