import { Transform } from 'class-transformer';

/**
 * Decimal values travel as strings (api-outline 1.1). Quantities allow up to
 * 4 decimal places (DB Decimal(14,4)); money allows 2 (Decimal(14,2)).
 * The transform tolerates JSON numbers by stringifying them before the
 * pattern check so `{"quantity": 5}` and `{"quantity": "5"}` both validate.
 */

export const QUANTITY_PATTERN = /^\d{1,10}(\.\d{1,4})?$/;
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const ToDecimalString = () =>
  Transform(({ value }) =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : value,
  );
