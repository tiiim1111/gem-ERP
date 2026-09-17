jest.mock('./env', () => ({ loadEnv: jest.fn() }));

import { AppConfigService } from './app-config.service';
import { loadEnv, type Env } from './env';

const mockedLoadEnv = loadEnv as jest.MockedFunction<typeof loadEnv>;

const BASE_ENV = {
  NODE_ENV: 'production',
  API_PORT: 3001,
  WEB_ORIGIN: ['http://192.168.0.50:3000'],
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_COOKIE_NAME: 'gemerp_session',
  SESSION_TTL_HOURS: 12,
  SESSION_COOKIE_SECURE: false,
  S3_ENABLED: true,
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET: 'bucket',
  S3_FORCE_PATH_STYLE: true,
} as unknown as Env;

function configWith(overrides: Partial<Env>): AppConfigService {
  mockedLoadEnv.mockReturnValue({ ...BASE_ENV, ...overrides });
  return new AppConfigService();
}

describe('AppConfigService.sessionCookieSecure', () => {
  afterEach(() => jest.clearAllMocks());

  // Regression: production used to force Secure on regardless of the flag,
  // which silently locked every user out of an HTTP-only on-premise
  // deployment — browsers discard a Secure cookie over http://, so sign-in
  // "did nothing" and showed no error.
  it('stays false in production when explicitly disabled', () => {
    const config = configWith({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: false });

    expect(config.isProduction).toBe(true);
    expect(config.sessionCookieSecure).toBe(false);
  });

  it('is true when explicitly enabled in production', () => {
    const config = configWith({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: true });
    expect(config.sessionCookieSecure).toBe(true);
  });

  it('follows the flag in development too', () => {
    const config = configWith({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: true });
    expect(config.sessionCookieSecure).toBe(true);
  });
});
