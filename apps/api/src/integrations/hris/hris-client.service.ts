/*
 * HTTP client for the HRIS employee feed.
 *
 * Fetches every advertised page, validates each one as it arrives, and
 * combines them into a snapshot. Nothing is reconciled until the whole
 * snapshot is in hand and consistent.
 */

import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  combineHrisPages,
  HrisPayloadError,
  parseHrisPage,
  type HrisPage,
  type HrisSnapshot,
} from './hris-payload';

/** Raised for transport-level failures, as opposed to bad payloads. */
export class HrisTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HrisTransportError';
  }
}

/** Hard cap so a producer advertising absurd totalPages cannot spin forever. */
const MAX_PAGES = 200;

/** The settings one page request needs. */
interface RequestConfig {
  baseUrl: string;
  token: string;
  employeePath: string;
  expectedCompanyCode: string;
  pageSize: number;
  timeoutMs: number;
}

/** Transient statuses worth one retry; anything else fails immediately. */
function isRetryable(status?: number): boolean {
  if (status === undefined) return true; // network/timeout
  return status === 429 || (status >= 500 && status <= 599);
}

@Injectable()
export class HrisClientService {
  private readonly logger = new Logger(HrisClientService.name);

  constructor(private readonly config: AppConfigService) {}

  /**
   * Pulls the full snapshot.
   *
   * @throws HrisTransportError for connection, timeout, auth or upstream
   * failures; HrisPayloadError when the response does not meet the contract.
   */
  async fetchSnapshot(): Promise<HrisSnapshot> {
    const hris = this.requestConfig(
      'The HRIS feed is not configured — set GEMENI_HRIS_BASE_URL and GEMENI_HRIS_TOKEN.',
    );

    const pages: HrisPage[] = [];
    let pageNumber = 1;
    let totalPages = 1;

    while (pageNumber <= totalPages) {
      if (pageNumber > MAX_PAGES) {
        throw new HrisPayloadError(
          `the feed advertised more than ${MAX_PAGES} pages — refusing to keep fetching`,
        );
      }
      const body = await this.getPage(hris, pageNumber);
      const page = parseHrisPage(body, hris.expectedCompanyCode, `page ${pageNumber}`);
      pages.push(page);
      totalPages = page.meta.totalPages === 0 ? 1 : page.meta.totalPages;
      pageNumber += 1;
    }

    const snapshot = combineHrisPages(pages);
    this.logger.log(
      `HRIS snapshot: ${snapshot.total} record(s) over ${snapshot.pagesFetched} page(s), company ${snapshot.companyCode}`,
    );
    return snapshot;
  }

  /** A redacted connectivity probe for the admin page — fetches page 1 only. */
  async probe(): Promise<{ total: number; companyCode: string; generatedAt: string }> {
    const hris = this.requestConfig('The HRIS feed is not configured.');
    const body = await this.getPage(hris, 1);
    const page = parseHrisPage(body, hris.expectedCompanyCode, 'probe');
    return {
      total: page.meta.total,
      companyCode: page.meta.companyCode,
      generatedAt: page.meta.generatedAt,
    };
  }

  /** Narrows the optional settings, failing loudly when either is missing. */
  private requestConfig(message: string): RequestConfig {
    const hris = this.config.hris;
    if (!hris.baseUrl || !hris.token) {
      throw new HrisTransportError(message);
    }
    return {
      baseUrl: hris.baseUrl,
      token: hris.token,
      employeePath: hris.employeePath,
      expectedCompanyCode: hris.expectedCompanyCode,
      pageSize: hris.pageSize,
      timeoutMs: hris.timeoutMs,
    };
  }

  private async getPage(hris: RequestConfig, page: number): Promise<unknown> {
    const url = new URL(hris.employeePath, hris.baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(hris.pageSize));

    let lastError: HrisTransportError | undefined;
    // One retry: enough for a restarting upstream, few enough that a real
    // outage surfaces quickly instead of holding the run open.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await this.requestOnce(url, hris.token, hris.timeoutMs);
      } catch (error) {
        if (!(error instanceof HrisTransportError) || !isRetryable(error.status) || attempt === 2) {
          throw error;
        }
        lastError = error;
        this.logger.warn(
          `HRIS page ${page} attempt ${attempt} failed (${error.message}) — retrying once`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw lastError ?? new HrisTransportError('HRIS request failed');
  }

  private async requestOnce(url: URL, token: string, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          // The only place the token is used. It is never logged or returned.
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        /*
         * The body is not included in the error. An upstream error page can
         * echo request headers, and this message reaches the sync run record
         * and the admin UI.
         */
        throw new HrisTransportError(
          response.status === 401
            ? 'HRIS rejected the bearer token (401). Check GEMENI_HRIS_TOKEN.'
            : `HRIS returned HTTP ${response.status}.`,
          response.status,
        );
      }

      try {
        return await response.json();
      } catch {
        throw new HrisTransportError('HRIS response was not valid JSON.');
      }
    } catch (error) {
      if (error instanceof HrisTransportError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HrisTransportError(`HRIS request timed out after ${timeoutMs}ms.`);
      }
      throw new HrisTransportError(
        `Could not reach the HRIS: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
