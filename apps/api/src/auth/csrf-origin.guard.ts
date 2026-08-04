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
      [...this.config.webOrigins, this.selfOrigin(request), this.forwardedOrigin(request)]
        .filter((origin): origin is string => Boolean(origin))
        .map((origin) => this.normalize(origin)),
    );
    if (allowed.has(this.normalize(sourceOrigin))) {
      return true;
    }
    // Same-origin requests riding the web server's /api/v1 proxy: the browser
    // attests same-origin-ness itself (Sec-Fetch-Site, all evergreen browsers).
    if (request.headers['sec-fetch-site'] === 'same-origin') {
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

  /**
   * Origin the browser actually addressed when the request rides a reverse
   * proxy (the Next.js /api/v1 rewrite sets x-forwarded-host/proto). Lets the
   * same-origin check hold under any hostname without listing it in
   * WEB_ORIGIN.
   */
  private forwardedOrigin(request: Request): string | null {
    const forwardedHost = request.headers['x-forwarded-host'];
    if (typeof forwardedHost !== 'string' || forwardedHost === '') {
      return null;
    }
    const forwardedProto = request.headers['x-forwarded-proto'];
    const scheme =
      typeof forwardedProto === 'string' && forwardedProto !== ''
        ? forwardedProto.split(',')[0].trim()
        : request.protocol;
    return `${scheme}://${forwardedHost.split(',')[0].trim()}`;
  }

  private normalize(origin: string): string {
    return origin.replace(/\/+$/, '').toLowerCase();
  }
}
