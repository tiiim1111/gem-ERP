import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const REQUEST_ID_PATTERN = /^[\w.-]{1,128}$/;

// `id` itself comes from pino-http's IncomingMessage augmentation.
export interface RequestWithCorrelation extends Request {
  correlationId?: string;
}

/**
 * Correlation-ID middleware: accepts a well-formed `x-request-id` header or
 * generates a UUID, stores it on the request (`req.id` is also what pino-http
 * picks up), and echoes it back on the response.
 */
export function correlationIdMiddleware(
  req: RequestWithCorrelation,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers['x-request-id'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const candidate =
    typeof req.id === 'string' && req.id !== ''
      ? req.id
      : headerValue && REQUEST_ID_PATTERN.test(headerValue)
        ? headerValue
        : uuidv4();

  req.id = candidate;
  req.correlationId = candidate;
  res.setHeader('x-request-id', candidate);
  next();
}

/** Shared generator for pino-http `genReqId` (same header-or-uuid logic). */
export function generateRequestId(req: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = req.headers['x-request-id'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (headerValue && REQUEST_ID_PATTERN.test(headerValue)) {
    return headerValue;
  }
  return uuidv4();
}
