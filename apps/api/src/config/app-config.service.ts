import { Injectable } from '@nestjs/common';
import { Env, loadEnv } from './env';

/**
 * Typed accessor over the validated environment. Injected everywhere instead
 * of touching process.env directly.
 */
@Injectable()
export class AppConfigService {
  private readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  get nodeEnv(): 'development' | 'test' | 'production' {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get apiPort(): number {
    return this.env.API_PORT;
  }

  /** All origins allowed for CORS/CSRF. */
  get webOrigins(): string[] {
    return this.env.WEB_ORIGIN;
  }

  /** Primary origin — used for links the API generates (QR scan URLs). */
  get webOrigin(): string {
    return this.env.WEB_ORIGIN[0];
  }

  get sessionCookieName(): string {
    return this.env.SESSION_COOKIE_NAME;
  }

  /** Sliding session time-to-live, in milliseconds. */
  get sessionTtlMs(): number {
    return this.env.SESSION_TTL_HOURS * 60 * 60 * 1000;
  }

  /** Secure cookies are forced on in production regardless of the flag. */
  get sessionCookieSecure(): boolean {
    return this.env.SESSION_COOKIE_SECURE || this.isProduction;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get s3Enabled(): boolean {
    return this.env.S3_ENABLED;
  }

  get s3Endpoint(): string {
    return this.env.S3_ENDPOINT;
  }

  get logLevel(): string {
    return this.env.LOG_LEVEL ?? (this.isProduction ? 'info' : 'debug');
  }
}
