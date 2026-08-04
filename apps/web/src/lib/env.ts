import { z } from 'zod';

/**
 * Browser-safe environment. `process.env.NEXT_PUBLIC_API_URL` is inlined at
 * build time; next.config.ts performs the same validation at server start so
 * a malformed value fails fast in every runtime.
 *
 * Accepts either the bare API origin (http://localhost:3001) or a value that
 * already carries the /api/v1 prefix — the base URL is normalized to always
 * end with /api/v1.
 */
const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

if (RAW_API_URL !== '') {
  const parsed = z.string().url().safeParse(RAW_API_URL);
  if (!parsed.success) {
    throw new Error(
      `Invalid NEXT_PUBLIC_API_URL: ${JSON.stringify(RAW_API_URL)} — must be an absolute URL such as http://localhost:3001`,
    );
  }
}

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  return /\/api\/v1$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`;
}

/**
 * API base URL including the /api/v1 prefix (no trailing slash).
 * Empty NEXT_PUBLIC_API_URL (the default) yields the RELATIVE base "/api/v1":
 * requests go to the web server's own origin and Next proxies them to the API
 * — same-origin from the browser's point of view under any hostname.
 */
export const API_BASE_URL = normalizeApiBaseUrl(RAW_API_URL);
