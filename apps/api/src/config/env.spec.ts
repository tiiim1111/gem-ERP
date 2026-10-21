import { loadEnv } from './env';

/*
 * docker-compose substitutes an unset `${VAR:-}` as `VAR=""`, not as an absent
 * variable. loadEnv exits the process on a validation failure, so an optional
 * setting that rejects the empty string stops the API from booting at all —
 * on every existing deployment, the moment the variable is added to the
 * compose file. That is the bug this file exists to prevent.
 */

const MINIMUM = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
};

/** Exactly what `docker compose config` emits when nothing is set. */
const COMPOSE_EMPTIES = {
  GEMENI_HRIS_BASE_URL: '',
  GEMENI_HRIS_EMPLOYEE_PATH: '',
  GEMENI_HRIS_EXPECTED_COMPANY_CODE: '',
  GEMENI_HRIS_TOKEN: '',
  GEMENI_HRIS_DEFAULT_BRANCH_CODE: '',
  GEMENI_HRIS_SYNC_CRON: '',
  GEMENI_HRIS_SYNC_TIMEZONE: '',
  GEMENI_HRIS_PAGE_SIZE: '',
  GEMENI_HRIS_TIMEOUT_MS: '',
  GEMENI_HRIS_POLL_MS: '',
};

const originalEnv = process.env;

/** loadEnv caches, so each case needs a fresh module registry. */
function loadWith(values: Record<string, string>) {
  jest.resetModules();
  process.env = { ...MINIMUM, ...values } as NodeJS.ProcessEnv;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('./env') as { loadEnv: typeof loadEnv }).loadEnv();
}

afterEach(() => {
  process.env = originalEnv;
  jest.resetModules();
});

describe('environment loading', () => {
  it('boots with every HRIS setting empty, as unconfigured compose supplies them', () => {
    const env = loadWith(COMPOSE_EMPTIES);

    expect(env.GEMENI_HRIS_SYNC_ENABLED).toBe(false);
    expect(env.GEMENI_HRIS_BASE_URL).toBeUndefined();
    expect(env.GEMENI_HRIS_TOKEN).toBeUndefined();
    expect(env.GEMENI_HRIS_DEFAULT_BRANCH_CODE).toBeUndefined();
    // The defaults must survive an empty override, not be replaced by it.
    expect(env.GEMENI_HRIS_EMPLOYEE_PATH).toBe('/api/v1/integrations/gemeni/employees');
    expect(env.GEMENI_HRIS_EXPECTED_COMPANY_CODE).toBe('GEM');
    expect(env.GEMENI_HRIS_SYNC_CRON).toBe('0 2 * * *');
    expect(env.GEMENI_HRIS_SYNC_TIMEZONE).toBe('Asia/Manila');
    expect(env.GEMENI_HRIS_PAGE_SIZE).toBe(200);
    expect(env.GEMENI_HRIS_TIMEOUT_MS).toBe(15000);
    expect(env.GEMENI_HRIS_POLL_MS).toBe(30000);
  });

  it('boots with the HRIS variables absent entirely', () => {
    const env = loadWith({});
    expect(env.GEMENI_HRIS_SYNC_ENABLED).toBe(false);
    expect(env.GEMENI_HRIS_BASE_URL).toBeUndefined();
  });

  it('reads a configured feed', () => {
    const env = loadWith({
      GEMENI_HRIS_SYNC_ENABLED: 'true',
      GEMENI_HRIS_BASE_URL: 'http://192.168.0.60',
      GEMENI_HRIS_TOKEN: 'a-token',
      GEMENI_HRIS_DEFAULT_BRANCH_CODE: 'MNL',
      GEMENI_HRIS_EXPECTED_COMPANY_CODE: 'GEM',
    });
    expect(env.GEMENI_HRIS_SYNC_ENABLED).toBe(true);
    expect(env.GEMENI_HRIS_BASE_URL).toBe('http://192.168.0.60');
    expect(env.GEMENI_HRIS_TOKEN).toBe('a-token');
    expect(env.GEMENI_HRIS_DEFAULT_BRANCH_CODE).toBe('MNL');
  });

  it('still rejects a base URL that is set but malformed', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => loadWith({ GEMENI_HRIS_BASE_URL: 'not-a-url' })).toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
