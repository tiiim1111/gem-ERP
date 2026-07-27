import { HttpException, ValidationError } from '@nestjs/common';
import type { ApiErrorDetail } from '@gemerp/shared';

/**
 * Application exception carrying the canonical error envelope:
 * `{ error: { code, message, details? } }`. Every deliberate error the API
 * raises goes through this class so the global filter can pass it straight
 * through.
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    details?: ApiErrorDetail[],
  ) {
    super(
      {
        error: {
          code,
          message,
          ...(details && details.length > 0 ? { details } : {}),
        },
      },
      status,
    );
  }

  static unauthenticated(message = 'Authentication required.'): AppException {
    return new AppException(401, 'UNAUTHENTICATED', message);
  }

  static invalidCredentials(
    message = 'Invalid email or password.',
  ): AppException {
    return new AppException(401, 'INVALID_CREDENTIALS', message);
  }

  static forbidden(message = 'You do not have permission to do this.') {
    return new AppException(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found.'): AppException {
    return new AppException(404, 'NOT_FOUND', message);
  }

  static duplicateCode(message: string): AppException {
    return new AppException(409, 'DUPLICATE_CODE', message);
  }

  static validation(details: ApiErrorDetail[], message = 'Validation failed.') {
    return new AppException(400, 'VALIDATION_ERROR', message, details);
  }

  static accountLocked(message: string): AppException {
    return new AppException(423, 'ACCOUNT_LOCKED', message);
  }
}

/**
 * Recursively flatten class-validator errors into per-field envelope details.
 * Used as the global ValidationPipe exceptionFactory.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    if (error.constraints) {
      for (const [code, message] of Object.entries(error.constraints)) {
        details.push({ field: path, message, code });
      }
    }
    if (error.children && error.children.length > 0) {
      details.push(...flattenValidationErrors(error.children, path));
    }
  }
  return details;
}

export function validationExceptionFactory(
  errors: ValidationError[],
): AppException {
  return AppException.validation(flattenValidationErrors(errors));
}
