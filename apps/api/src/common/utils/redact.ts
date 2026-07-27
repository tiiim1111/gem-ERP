/**
 * Deep redaction of sensitive keys before values are persisted to the audit
 * log or written to structured logs. Credentials, tokens, and hashes must
 * never appear in audit rows.
 */
const SENSITIVE_KEY_PATTERN =
  /pass(word)?|token|secret|hash|credential|authorization|cookie/i;

const MAX_DEPTH = 8;

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (depth > MAX_DEPTH) {
    return '[TRUNCATED]';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : redactSensitive(entry, depth + 1);
    }
    return result;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}
