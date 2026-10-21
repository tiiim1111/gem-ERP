import { HrisClientService, HrisTransportError } from './hris-client.service';
import { HrisPayloadError } from './hris-payload';
import type { AppConfigService } from '../../config/app-config.service';

/*
 * Transport behaviour. The recurring theme: a failure must be reported as a
 * failure, because the sync job treats a successful call as the truth about
 * who works here.
 */

const BASE = {
  enabled: true,
  baseUrl: 'http://hris.test',
  employeePath: '/api/v1/integrations/gemeni/employees',
  expectedCompanyCode: 'GEM',
  token: 'secret-token-value',
  defaultBranchCode: 'MNL',
  cron: '0 2 * * *',
  timezone: 'Asia/Manila',
  pageSize: 200,
  timeoutMs: 1000,
  pollMs: 30000,
};

function configFor(overrides: Partial<typeof BASE> = {}): AppConfigService {
  const hris = { ...BASE, ...overrides };
  return {
    hris,
    hrisConfigured: Boolean(hris.baseUrl && hris.token),
  } as unknown as AppConfigService;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    hrisId: 'hris-1',
    employeeNumber: 'GC-0001',
    firstName: 'Ana',
    middleName: null,
    lastName: 'Reyes',
    workEmail: null,
    departmentCode: 'ADMIN',
    positionCode: 'ITO',
    employmentStatus: 'ACTIVE',
    dateHired: '2024-03-04',
    archivedAt: null,
    updatedAt: '2026-10-20T06:12:44Z',
    ...overrides,
  };
}

function pageBody(
  data: Array<Record<string, unknown>>,
  meta: Record<string, unknown> = {},
) {
  return {
    data,
    meta: {
      companyCode: 'GEM',
      snapshot: true,
      page: 1,
      pageSize: 200,
      total: data.length,
      totalPages: data.length === 0 ? 0 : 1,
      generatedAt: '2026-10-21T01:30:00Z',
      ...meta,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Runs a call that must reject, and hands back the error it threw. */
async function errorFrom(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (caught) {
    return caught as Error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

describe('HrisClientService', () => {
  it('fetches a single page and returns the snapshot', async () => {
    fetchMock.mockResolvedValue(jsonResponse(pageBody([row()])));
    const snapshot = await new HrisClientService(configFor()).fetchSnapshot();

    expect(snapshot.total).toBe(1);
    expect(snapshot.pagesFetched).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the bearer token and asks for JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(pageBody([row()])));
    await new HrisClientService(configFor()).fetchSnapshot();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'http://hris.test/api/v1/integrations/gemeni/employees?page=1&pageSize=200',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-token-value',
    );
  });

  it('follows pagination to the advertised page count', async () => {
    const meta = { pageSize: 1, total: 2, totalPages: 2 };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(pageBody([row()], { ...meta, page: 1 })))
      .mockResolvedValueOnce(
        jsonResponse(
          pageBody([row({ hrisId: 'hris-2', employeeNumber: 'GC-0002' })], {
            ...meta,
            page: 2,
          }),
        ),
      );

    const snapshot = await new HrisClientService(configFor()).fetchSnapshot();
    expect(snapshot.employees).toHaveLength(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('page=2');
  });

  describe('failures', () => {
    it('reports a 401 as a token problem', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 401));
      await expect(new HrisClientService(configFor()).fetchSnapshot()).rejects.toThrow(
        /rejected the bearer token/,
      );
    });

    it('does not retry a 401', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 401));
      await expect(new HrisClientService(configFor()).fetchSnapshot()).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries once on a 500 and succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, 500))
        .mockResolvedValueOnce(jsonResponse(pageBody([row()])));

      const snapshot = await new HrisClientService(configFor()).fetchSnapshot();
      expect(snapshot.total).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after the second failure', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 503));
      await expect(new HrisClientService(configFor()).fetchSnapshot()).rejects.toThrow(
        /HTTP 503/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports a network failure rather than an empty snapshot', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(new HrisClientService(configFor()).fetchSnapshot()).rejects.toThrow(
        /Could not reach the HRIS/,
      );
    });

    it('reports a timeout', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      fetchMock.mockRejectedValue(abortError);
      await expect(new HrisClientService(configFor()).fetchSnapshot()).rejects.toThrow(
        /timed out after 1000ms/,
      );
    });

    it('reports a non-JSON body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('invalid json');
        },
      } as unknown as Response);
      await expect(new HrisClientService(configFor()).fetchSnapshot()).rejects.toThrow(
        /not valid JSON/,
      );
    });

    it('rejects a payload from the wrong company', async () => {
      fetchMock.mockResolvedValue(jsonResponse(pageBody([row()], { companyCode: 'OTHER' })));
      await expect(new HrisClientService(configFor()).fetchSnapshot()).rejects.toBeInstanceOf(
        HrisPayloadError,
      );
    });

    it('fails clearly when nothing is configured', async () => {
      await expect(
        new HrisClientService(configFor({ baseUrl: undefined })).fetchSnapshot(),
      ).rejects.toBeInstanceOf(HrisTransportError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('the token never leaks', () => {
    /*
     * These error strings reach the sync run record, the admin page and the
     * logs. An upstream error page can echo request headers, which is why the
     * response body is never folded into the message.
     */
    it('keeps the token out of a 401 message', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: 'bad token: secret-token-value' }, 401),
      );
      const error = await errorFrom(new HrisClientService(configFor()).fetchSnapshot());
      expect(error.message).not.toContain('secret-token-value');
      expect(error.message).toMatch(/rejected the bearer token/);
    });

    it('keeps the token out of a transport message', async () => {
      fetchMock.mockRejectedValue(new Error('connect failed'));
      const error = await errorFrom(new HrisClientService(configFor()).fetchSnapshot());
      expect(error.message).not.toContain('secret-token-value');
    });

    it('keeps the token out of a payload message', async () => {
      fetchMock.mockResolvedValue(jsonResponse(pageBody([row({ salary: 1 })])));
      const error = await errorFrom(new HrisClientService(configFor()).fetchSnapshot());
      expect(error.message).not.toContain('secret-token-value');
    });
  });

  describe('probe', () => {
    it('returns counts and metadata only', async () => {
      fetchMock.mockResolvedValue(jsonResponse(pageBody([row()])));
      const result = await new HrisClientService(configFor()).probe();
      expect(result).toEqual({
        total: 1,
        companyCode: 'GEM',
        generatedAt: '2026-10-21T01:30:00Z',
      });
      // One page only — a probe must not pull the whole roster.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
