import type { ApiError, ApiErrorDetail } from '@gemerp/shared';
import { API_BASE_URL } from './env';

/**
 * Typed error thrown for every non-2xx API response. Wraps the canonical
 * error envelope `{ error: { code, message, details? } }`.
 */
export class ApiClientError extends Error {
  /** HTTP status (0 when the server was unreachable). */
  readonly status: number;
  /** Stable machine code, e.g. VALIDATION_ERROR, INVALID_CREDENTIALS. */
  readonly code: string;
  /** Per-field details for VALIDATION_ERROR responses. */
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Map of field path -> first message, for wiring into form errors. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      if (detail.field && !(detail.field in map)) {
        map[detail.field] = detail.message;
      }
    }
    return map;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/** True when the server rejected a PATCH because the record's `version` is stale. */
export function isVersionConflict(error: unknown): boolean {
  return isApiClientError(error) && error.code === 'VERSION_CONFLICT';
}

/** Human-safe message for any thrown value. */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (isApiClientError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type QueryValue = string | number | boolean | null | undefined;

/** Query params; null/undefined/'' entries are omitted from the URL. */
export type QueryParams = Record<string, QueryValue>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Sent as the Idempotency-Key header on posting-sensitive operations
   * (post/reverse/dispatch/receive/assign/return/dispose per contract §1.5).
   */
  idempotencyKey?: string;
}

function buildUrl(path: string, params?: QueryParams): string {
  // API_BASE_URL may be relative ("/api/v1") — resolve against the page
  // origin so the request stays same-origin and rides the Next proxy.
  const base =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const url = new URL(`${API_BASE_URL}${path}`, base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseErrorEnvelope(payload: unknown): ApiError['error'] | undefined {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'code' in payload.error &&
    'message' in payload.error
  ) {
    return payload.error as ApiError['error'];
  }
  return undefined;
}

/**
 * Form selects submit "" when an optional reference is left blank, but the
 * API's UUID validators reject empty strings. Recursively convert ""
 * to null on keys ending in "Id" (null passes @IsOptional and means "clear"
 * on PATCH). Other empty strings (descriptions, notes) pass through.
 */
function sanitizeBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeBody);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        key.endsWith('Id') && entry === '' ? null : sanitizeBody(entry),
      ]),
    );
  }
  return value;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', params, body, signal, idempotencyKey } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body !== undefined ? JSON.stringify(sanitizeBody(body)) : undefined,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const envelope = parseErrorEnvelope(payload);
    if (envelope) {
      throw new ApiClientError(response.status, envelope.code, envelope.message, envelope.details);
    }
    throw new ApiClientError(
      response.status,
      'INTERNAL_ERROR',
      `Request failed with status ${response.status}.`,
    );
  }

  return payload as T;
}

/**
 * Multipart POST (file uploads). Content-Type is left to the browser so the
 * multipart boundary is set correctly. Same error-envelope handling as JSON.
 */
async function postFormData<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
  } catch {
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const envelope = parseErrorEnvelope(payload);
    if (envelope) {
      throw new ApiClientError(response.status, envelope.code, envelope.message, envelope.details);
    }
    throw new ApiClientError(
      response.status,
      'INTERNAL_ERROR',
      `Upload failed with status ${response.status}.`,
    );
  }

  return payload as T;
}

/**
 * Authenticated file download (import templates, result files). Returns the
 * blob plus the filename from Content-Disposition when the server provides one.
 */
export async function downloadFile(
  path: string,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path), { credentials: 'include' });
  } catch {
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      payload = undefined;
    }
    const envelope = parseErrorEnvelope(payload);
    if (envelope) {
      throw new ApiClientError(response.status, envelope.code, envelope.message, envelope.details);
    }
    throw new ApiClientError(
      response.status,
      'INTERNAL_ERROR',
      `Download failed with status ${response.status}.`,
    );
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  return { blob: await response.blob(), filename };
}

/**
 * Authenticated binary GET returning the blob and its content type — used for
 * label rendering where the response may be PNG, SVG, PDF, or ZPL text.
 */
export async function fetchBinary(
  path: string,
  params?: QueryParams,
  signal?: AbortSignal,
): Promise<{ blob: Blob; contentType: string }> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), { credentials: 'include', signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      payload = undefined;
    }
    const envelope = parseErrorEnvelope(payload);
    if (envelope) {
      throw new ApiClientError(response.status, envelope.code, envelope.message, envelope.details);
    }
    throw new ApiClientError(
      response.status,
      'INTERNAL_ERROR',
      `Request failed with status ${response.status}.`,
    );
  }

  const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
  return { blob: await response.blob(), contentType };
}

/** Trigger a browser download of a fetched blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Thin typed wrappers over fetch with cookie credentials and the error envelope. */
export const api = {
  get<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { method: 'GET', params, signal });
  },
  post<T>(path: string, body?: unknown, options?: { idempotencyKey?: string }): Promise<T> {
    return request<T>(path, { method: 'POST', body, idempotencyKey: options?.idempotencyKey });
  },
  postForm<T>(path: string, form: FormData): Promise<T> {
    return postFormData<T>(path, form);
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};
