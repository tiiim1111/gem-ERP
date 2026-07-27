import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../common/errors/app.exception';
import { AppConfigService } from '../config/app-config.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in depth alongside the SameSite=Lax session cookie:
 * state-changing (non-GET) requests carrying an Origin (or Referer) from a
 * browser must originate from the configured web app or from the API's own
 * origin (Swagger UI). Requests without either header — curl, server-to-
 * server — pass through; cookies are not auto-attached in those cases.
 */
@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const sourceOrigin = this.requestSourceOrigin(request);
    if (sourceOrigin === null) {
      return true;
    }

    const allowed = new Set(
      [this.config.webOrigin, this.selfOrigin(request)]
        .filter((origin): origin is string => Boolean(origin))
        .map((origin) => this.normalize(origin)),
    );
    if (allowed.has(this.normalize(sourceOrigin))) {
      return true;
    }
    throw AppException.forbidden('Cross-origin request rejected.');
  }

  private requestSourceOrigin(request: Request): string | null {
    const origin = request.headers.origin;
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      return origin;
    }
    const referer = request.headers.referer;
    if (typeof referer === 'string' && referer !== '') {
      try {
        return new URL(referer).origin;
      } catch {
        return 'invalid://referer';
      }
    }
    return null;
  }

  private selfOrigin(request: Request): string | null {
    const host = request.headers.host;
    if (!host) {
      return null;
    }
    return `${request.protocol}://${host}`;
  }

  private normalize(origin: string): string {
    return origin.replace(/\/+$/, '').toLowerCase();
  }
}
