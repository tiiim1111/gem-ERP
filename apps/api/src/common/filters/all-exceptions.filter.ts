import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError, ApiErrorDetail } from '@gemerp/shared';

/** Default machine codes per HTTP status for exceptions without one. */
const STATUS_CODE_MAP: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  423: 'ACCOUNT_LOCKED',
  429: 'RATE_LIMITED',
};

interface PrismaKnownErrorLike {
  code: string;
  clientVersion: string;
  meta?: { target?: unknown; [key: string]: unknown };
  message?: string;
}

/**
 * Duck-typed detection of Prisma "known request" errors (P2002 etc.) so this
 * filter never needs a runtime import of @prisma/client error classes.
 */
function asPrismaKnownError(exception: unknown): PrismaKnownErrorLike | null {
  if (
    typeof exception === 'object' &&
    exception !== null &&
    'code' in exception &&
    'clientVersion' in exception &&
    typeof (exception as { code: unknown }).code === 'string' &&
    /^P\d{4}$/.test((exception as { code: string }).code)
  ) {
    return exception as unknown as PrismaKnownErrorLike;
  }
  return null;
}

function isErrorEnvelope(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiError).error === 'object' &&
    (value as ApiError).error !== null &&
    typeof (value as ApiError).error.code === 'string' &&
    typeof (value as ApiError).error.message === 'string'
  );
}

/**
 * Global exception filter producing the canonical error envelope
 * `{ error: { code, message, details? } }` for EVERY error response.
 * Stack traces, SQL, and internal messages are never sent to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const { status, body } = this.toEnvelope(exception);

    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      const message =
        exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `Unhandled exception on ${request?.method ?? '?'} ${request?.url ?? '?'} ` +
          `[${request?.correlationId ?? '-'}]: ${message}`,
        stack,
      );
    }

    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ApiError } {
    // 1. HttpException (including AppException which already carries the envelope).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (isErrorEnvelope(raw)) {
        return { status, body: raw };
      }
      return { status, body: this.genericEnvelope(status, raw, exception) };
    }

    // 2. Prisma known request errors (duck-typed).
    const prismaError = asPrismaKnownError(exception);
    if (prismaError) {
      return this.prismaEnvelope(prismaError);
    }

    // 3. Body-parser JSON syntax errors surface as SyntaxError with a body.
    if (exception instanceof SyntaxError && 'body' in exception) {
      return {
        status: 400,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Malformed JSON in request body.',
          },
        },
      };
    }

    // 4. Anything else: opaque 500.
    return {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred. Please try again later.',
        },
      },
    };
  }

  private genericEnvelope(
    status: number,
    raw: unknown,
    exception: HttpException,
  ): ApiError {
    const code =
      STATUS_CODE_MAP[status] ??
      (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');

    let message = exception.message;
    let details: ApiErrorDetail[] | undefined;

    if (typeof raw === 'string') {
      message = raw;
    } else if (typeof raw === 'object' && raw !== null && 'message' in raw) {
      const rawMessage = (raw as { message: unknown }).message;
      if (typeof rawMessage === 'string') {
        message = rawMessage;
      } else if (Array.isArray(rawMessage)) {
        message = 'Validation failed.';
        details = rawMessage
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => ({ message: entry }));
      }
    }

    if (status >= 500) {
      // Never leak internals for server errors.
      message = 'An unexpected error occurred. Please try again later.';
      details = undefined;
    } else if (status === 429) {
      message = 'Too many requests. Please try again later.';
    }

    return {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details } : {}),
      },
    };
  }

  private prismaEnvelope(error: PrismaKnownErrorLike): {
    status: number;
    body: ApiError;
  } {
    switch (error.code) {
      case 'P2002': {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta?.target as unknown[]).join(', ')
          : undefined;
        return {
          status: 409,
          body: {
            error: {
              code: 'DUPLICATE_CODE',
              message: target
                ? `A record with the same unique value already exists (${target}).`
                : 'A record with the same unique value already exists.',
            },
          },
        };
      }
      case 'P2025':
        return {
          status: 404,
          body: {
            error: { code: 'NOT_FOUND', message: 'Resource not found.' },
          },
        };
      case 'P2003':
        return {
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message:
                'The operation conflicts with a reference to another record.',
            },
          },
        };
      default:
        this.logger.error(
          `Prisma error ${error.code}: ${error.message ?? 'unknown'}`,
        );
        return {
          status: 500,
          body: {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'An unexpected error occurred. Please try again later.',
            },
          },
        };
    }
  }
}
