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
}

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(`${API_BASE_URL}${path}`);
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', params, body, signal } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body });
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
