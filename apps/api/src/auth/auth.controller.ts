import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { AppConfigService } from '../config/app-config.service';
import { AuthService } from './auth.service';
import { SessionService, SessionView } from './session.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate and set the session cookie.' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUser> {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      auditContextFrom(req),
    );
    this.setSessionCookie(res, result.token);
    return result.user;
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Destroy the current session and clear the cookie.' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (req.sessionId) {
      await this.auth.logout(user.id, req.sessionId, auditContextFrom(req));
    }
    this.clearSessionCookie(res);
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({
    summary:
      'Current user with flattened roles, effective permissions, and branch IDs.',
  })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Change own password; every other session is revoked.',
  })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    if (!req.sessionId) {
      throw AppException.unauthenticated();
    }
    await this.auth.changePassword(
      user.id,
      req.sessionId,
      dto.currentPassword,
      dto.newPassword,
      auditContextFrom(req),
    );
    return { message: 'Password changed. Other sessions have been revoked.' };
  }

  @Get('sessions')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'List own active sessions.' })
  async listSessions(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<SessionView[]> {
    return this.sessions.listForUser(user.id, req.sessionId ?? '');
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke one of own sessions.' })
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.auth.revokeOwnSession(user.id, id, auditContextFrom(req));
  }

  private setSessionCookie(res: Response, token: string): void {
    // Deliberately no maxAge: the browser keeps a session cookie while the
    // server enforces the authoritative 12h sliding expiry.
    res.cookie(this.config.sessionCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.sessionCookieSecure,
      path: '/',
    });
  }

  private clearSessionCookie(res: Response): void {
    res.clearCookie(this.config.sessionCookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.sessionCookieSecure,
      path: '/',
    });
  }
}
