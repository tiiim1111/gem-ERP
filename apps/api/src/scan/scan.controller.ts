import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { ResolveCodeDto } from './dto/resolve-code.dto';
import { ScanAssetResult, ScanResult, ScanService } from './scan.service';

/**
 * Scanning (api-outline 4.4). QR codes carry opaque scan tokens — never
 * record data. Resolution always re-checks auth, permission, and branch scope
 * on the resolved record.
 */
@ApiTags('scan')
@ApiCookieAuth()
@Controller('scan')
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  @Post('resolve')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Resolve raw scanner/keyboard input (asset tag, scan URL, SKU, alternate barcode, lot, bin, serial) → {kind, id, summary}. Per-kind view permission enforced.',
  })
  resolve(
    @CurrentUser() user: AuthUser,
    @Body() dto: ResolveCodeDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ScanResult> {
    return this.scan.resolveCode(user, dto.code, auditContextFrom(req));
  }

  @Get(':token')
  @RequirePermissions(PERMISSIONS.asset.view)
  @ApiOperation({
    summary:
      'Resolve an opaque QR scan token → asset summary + permitted actions. Unknown and out-of-scope tokens answer identically (404 SCAN_TOKEN_NOT_FOUND).',
  })
  @ApiParam({ name: 'token', description: 'Opaque scan token from the QR URL.' })
  resolveToken(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ScanAssetResult> {
    return this.scan.resolveToken(user, token, auditContextFrom(req));
  }
}
