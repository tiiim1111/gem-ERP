'use client';

import * as React from 'react';

/** UUID for Idempotency-Key headers; falls back for non-secure contexts. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC-4122-ish fallback (older WebViews without crypto.randomUUID).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * A per-attempt Idempotency-Key that stays STABLE across retries of the same
 * click (so the server can dedupe) and rotates only after a successful call
 * (via `rotate`) or when `resetSignal` changes (e.g. a dialog re-opening for a
 * fresh attempt).
 */
export function useIdempotencyKey(resetSignal?: unknown): { key: string; rotate: () => void } {
  const [key, setKey] = React.useState<string>(() => newIdempotencyKey());
  const lastSignal = React.useRef(resetSignal);

  React.useEffect(() => {
    if (lastSignal.current !== resetSignal) {
      lastSignal.current = resetSignal;
      setKey(newIdempotencyKey());
    }
  }, [resetSignal]);

  const rotate = React.useCallback(() => setKey(newIdempotencyKey()), []);

  return { key, rotate };
}
