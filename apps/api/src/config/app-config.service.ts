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

  get webOrigin(): string {
    return this.env.WEB_ORIGIN;
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

  get s3Endpoint(): string {
    return this.env.S3_ENDPOINT;
  }

  get logLevel(): string {
    return this.env.LOG_LEVEL ?? (this.isProduction ? 'info' : 'debug');
  }
}
