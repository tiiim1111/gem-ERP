import { BusinessCategory, EmployeeStatus, TrackingMethod } from '@prisma/client';
import {
  defaultTrackingMethod,
  isAllowedCombo,
} from '../items/item-classification';
import { LOOKUP_TYPES, LookupType } from '../lookups/lookup-types';

/**
 * Pure, DB-free row validation for staged CSV imports (unit-testable).
 * The service loads reference data once and passes it in; validators report
 * every problem per row as machine-coded errors (spec §24 row-level errors).
 */

export interface ImportRowError {
  /** 1-based data row number (header row excluded). */
  row: number;
  field: string;
  code:
    | 'REQUIRED'
    | 'BAD_FORMAT'
    | 'BAD_ENUM'
    | 'BAD_DATE'
    | 'BAD_NUMBER'
    | 'REF_NOT_FOUND'
    | 'DUPLICATE'
    | 'FORBIDDEN_BRANCH'
    | 'INVALID_COMBO';
  message: string;
}

export type CsvRow = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

function get(row: CsvRow, field: string): string {
  return (row[field] ?? '').trim();
}

function isValidDate(value: string): boolean {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// ---------------------------------------------------------------- employees

export interface EmployeeImportRefs {
  /** Branch code → id for every existing branch. */
  branchCodes: ReadonlySet<string>;
  /** Branch codes the importing user may write to; null = unrestricted. */
  accessibleBranchCodes: ReadonlySet<string> | null;
  departmentCodes: ReadonlySet<string>;
  positionCodes: ReadonlySet<string>;
  /** Employee numbers already in the database. */
  existingEmployeeNumbers: ReadonlySet<string>;
  /** Work emails already in the database (lowercase). */
  existingWorkEmails: ReadonlySet<string>;
}

export interface ValidatedEmployeeRow {
  employeeNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  displayName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  branchCode: string;
  departmentCode: string | null;
  positionCode: string | null;
  supervisorEmployeeNumber: string | null;
  status: EmployeeStatus;
  startDate: string | null;
}

export function validateEmployeeRow(
  rowNumber: number,
  row: CsvRow,
  refs: EmployeeImportRefs,
  seenInFile: { employeeNumbers: Set<string>; workEmails: Set<string> },
): { data: ValidatedEmployeeRow | null; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const push = (field: string, code: ImportRowError['code'], message: string) =>
    errors.push({ row: rowNumber, field, code, message });

  const firstName = get(row, 'firstName');
  const lastName = get(row, 'lastName');
  if (!firstName) {
    push('firstName', 'REQUIRED', 'firstName is required.');
  }
  if (!lastName) {
    push('lastName', 'REQUIRED', 'lastName is required.');
  }

  const employeeNumber = get(row, 'employeeNumber').toUpperCase() || null;
  if (employeeNumber) {
    if (!CODE_PATTERN.test(employeeNumber)) {
      push('employeeNumber', 'BAD_FORMAT', 'employeeNumber has an invalid format.');
    } else if (seenInFile.employeeNumbers.has(employeeNumber)) {
      push('employeeNumber', 'DUPLICATE', `Duplicate employeeNumber "${employeeNumber}" in file.`);
    } else if (refs.existingEmployeeNumbers.has(employeeNumber)) {
      push('employeeNumber', 'DUPLICATE', `employeeNumber "${employeeNumber}" already exists.`);
    } else {
      seenInFile.employeeNumbers.add(employeeNumber);
    }
  }

  const workEmailRaw = get(row, 'workEmail');
  const workEmail = workEmailRaw ? workEmailRaw.toLowerCase() : null;
  if (workEmail) {
    if (!EMAIL_PATTERN.test(workEmail)) {
      push('workEmail', 'BAD_FORMAT', 'workEmail is not a valid email address.');
    } else if (seenInFile.workEmails.has(workEmail)) {
      push('workEmail', 'DUPLICATE', `Duplicate workEmail "${workEmail}" in file.`);
    } else if (refs.existingWorkEmails.has(workEmail)) {
      push('workEmail', 'DUPLICATE', `workEmail "${workEmail}" already exists.`);
    } else {
      seenInFile.workEmails.add(workEmail);
    }
  }

  const branchCode = get(row, 'branchCode').toUpperCase();
  if (!branchCode) {
    push('branchCode', 'REQUIRED', 'branchCode is required.');
  } else if (!refs.branchCodes.has(branchCode)) {
    push('branchCode', 'REF_NOT_FOUND', `Branch "${branchCode}" does not exist.`);
  } else if (
    refs.accessibleBranchCodes !== null &&
    !refs.accessibleBranchCodes.has(branchCode)
  ) {
    push('branchCode', 'FORBIDDEN_BRANCH', `You do not have access to branch "${branchCode}".`);
  }

  const departmentCode = get(row, 'departmentCode').toUpperCase() || null;
  if (departmentCode && !refs.departmentCodes.has(departmentCode)) {
    push('departmentCode', 'REF_NOT_FOUND', `Department "${departmentCode}" does not exist.`);
  }
  const positionCode = get(row, 'positionCode').toUpperCase() || null;
  if (positionCode && !refs.positionCodes.has(positionCode)) {
    push('positionCode', 'REF_NOT_FOUND', `Position "${positionCode}" does not exist.`);
  }

  const supervisorEmployeeNumber =
    get(row, 'supervisorEmployeeNumber').toUpperCase() || null;
  if (
    supervisorEmployeeNumber &&
    !refs.existingEmployeeNumbers.has(supervisorEmployeeNumber)
  ) {
    push(
      'supervisorEmployeeNumber',
      'REF_NOT_FOUND',
      `Supervisor "${supervisorEmployeeNumber}" does not exist (import supervisors first).`,
    );
  }

  const statusRaw = get(row, 'status').toUpperCase();
  let status: EmployeeStatus = EmployeeStatus.ACTIVE;
  if (statusRaw) {
    if ((Object.values(EmployeeStatus) as string[]).includes(statusRaw)) {
      status = statusRaw as EmployeeStatus;
    } else {
      push(
        'status',
        'BAD_ENUM',
        `status must be one of ${Object.values(EmployeeStatus).join(', ')}.`,
      );
    }
  }

  const startDate = get(row, 'startDate') || null;
  if (startDate && !isValidDate(startDate)) {
    push('startDate', 'BAD_DATE', 'startDate must be an ISO date (YYYY-MM-DD).');
  }

  if (errors.length > 0) {
    return { data: null, errors };
  }
  return {
    data: {
      employeeNumber,
      firstName,
      middleName: get(row, 'middleName') || null,
      lastName,
      displayName: get(row, 'displayName') || null,
      workEmail,
      workPhone: get(row, 'workPhone') || null,
      branchCode,
      departmentCode,
      positionCode,
      supervisorEmployeeNumber,
      status,
      startDate,
    },
    errors,
  };
}

// --------------------------------------------------------------------- items

export interface ItemImportRefs {
  categoryCodes: ReadonlySet<string>;
  /** category code → subcategory codes. */
  subcategoryCodesByCategory: ReadonlyMap<string, ReadonlySet<string>>;
  brandCodes: ReadonlySet<string>;
  manufacturerCodes: ReadonlySet<string>;
  uomCodes: ReadonlySet<string>;
  existingSkus: ReadonlySet<string>;
  /** Barcodes with an ACTIVE mapping anywhere in the catalog. */
  activeBarcodes: ReadonlySet<string>;
}

export interface ValidatedItemRow {
  sku: string | null;
  name: string;
  description: string | null;
  businessCategory: BusinessCategory;
  trackingMethod: TrackingMethod;
  categoryCode: string | null;
  subcategoryCode: string | null;
  brandCode: string | null;
  manufacturerCode: string | null;
  model: string | null;
  baseUomCode: string;
  purchaseUomCode: string | null;
  issueUomCode: string | null;
  standardCost: string | null;
  barcode: string | null;
}

export function validateItemRow(
  rowNumber: number,
  row: CsvRow,
  refs: ItemImportRefs,
  seenInFile: { skus: Set<string>; barcodes: Set<string> },
): { data: ValidatedItemRow | null; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const push = (field: string, code: ImportRowError['code'], message: string) =>
    errors.push({ row: rowNumber, field, code, message });

  const name = get(row, 'name');
  if (!name) {
    push('name', 'REQUIRED', 'name is required.');
  }

  const businessCategoryRaw = get(row, 'businessCategory').toUpperCase();
  let businessCategory: BusinessCategory | null = null;
  if (!businessCategoryRaw) {
    push('businessCategory', 'REQUIRED', 'businessCategory is required.');
  } else if (
    (Object.values(BusinessCategory) as string[]).includes(businessCategoryRaw)
  ) {
    businessCategory = businessCategoryRaw as BusinessCategory;
  } else {
    push(
      'businessCategory',
      'BAD_ENUM',
      `businessCategory must be one of ${Object.values(BusinessCategory).join(', ')}.`,
    );
  }

  const trackingMethodRaw = get(row, 'trackingMethod').toUpperCase();
  let trackingMethod: TrackingMethod | null = null;
  if (trackingMethodRaw) {
    if ((Object.values(TrackingMethod) as string[]).includes(trackingMethodRaw)) {
      trackingMethod = trackingMethodRaw as TrackingMethod;
    } else {
      push(
        'trackingMethod',
        'BAD_ENUM',
        `trackingMethod must be one of ${Object.values(TrackingMethod).join(', ')}.`,
      );
    }
  }
  if (businessCategory) {
    trackingMethod = trackingMethod ?? defaultTrackingMethod(businessCategory);
    if (
      trackingMethodRaw &&
      trackingMethod &&
      !isAllowedCombo(businessCategory, trackingMethod)
    ) {
      push(
        'trackingMethod',
        'INVALID_COMBO',
        `${businessCategory} does not allow ${trackingMethod} tracking (spec §4).`,
      );
    }
  }

  const sku = get(row, 'sku').toUpperCase() || null;
  if (sku) {
    if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(sku)) {
      push('sku', 'BAD_FORMAT', 'sku has an invalid format.');
    } else if (seenInFile.skus.has(sku)) {
      push('sku', 'DUPLICATE', `Duplicate sku "${sku}" in file.`);
    } else if (refs.existingSkus.has(sku)) {
      push('sku', 'DUPLICATE', `sku "${sku}" already exists.`);
    } else {
      seenInFile.skus.add(sku);
    }
  }

  const categoryCode = get(row, 'categoryCode').toUpperCase() || null;
  if (categoryCode && !refs.categoryCodes.has(categoryCode)) {
    push('categoryCode', 'REF_NOT_FOUND', `Category "${categoryCode}" does not exist.`);
  }
  if (!sku && !categoryCode) {
    push(
      'categoryCode',
      'REQUIRED',
      'categoryCode is required when sku is omitted (SKU-{CATEGORY}-{SEQ} generation).',
    );
  }
  const subcategoryCode = get(row, 'subcategoryCode').toUpperCase() || null;
  if (subcategoryCode) {
    const valid =
      categoryCode !== null &&
      (refs.subcategoryCodesByCategory.get(categoryCode)?.has(subcategoryCode) ??
        false);
    if (!valid) {
      push(
        'subcategoryCode',
        'REF_NOT_FOUND',
        `Subcategory "${subcategoryCode}" does not exist under category "${categoryCode ?? ''}".`,
      );
    }
  }

  const brandCode = get(row, 'brandCode').toUpperCase() || null;
  if (brandCode && !refs.brandCodes.has(brandCode)) {
    push('brandCode', 'REF_NOT_FOUND', `Brand "${brandCode}" does not exist.`);
  }
  const manufacturerCode = get(row, 'manufacturerCode').toUpperCase() || null;
  if (manufacturerCode && !refs.manufacturerCodes.has(manufacturerCode)) {
    push(
      'manufacturerCode',
      'REF_NOT_FOUND',
      `Manufacturer "${manufacturerCode}" does not exist.`,
    );
  }

  const baseUomCode = get(row, 'baseUomCode').toUpperCase();
  if (!baseUomCode) {
    push('baseUomCode', 'REQUIRED', 'baseUomCode is required.');
  } else if (!refs.uomCodes.has(baseUomCode)) {
    push('baseUomCode', 'REF_NOT_FOUND', `UOM "${baseUomCode}" does not exist.`);
  }
  const purchaseUomCode = get(row, 'purchaseUomCode').toUpperCase() || null;
  if (purchaseUomCode && !refs.uomCodes.has(purchaseUomCode)) {
    push('purchaseUomCode', 'REF_NOT_FOUND', `UOM "${purchaseUomCode}" does not exist.`);
  }
  const issueUomCode = get(row, 'issueUomCode').toUpperCase() || null;
  if (issueUomCode && !refs.uomCodes.has(issueUomCode)) {
    push('issueUomCode', 'REF_NOT_FOUND', `UOM "${issueUomCode}" does not exist.`);
  }

  const standardCost = get(row, 'standardCost') || null;
  if (standardCost && !MONEY_PATTERN.test(standardCost)) {
    push('standardCost', 'BAD_NUMBER', 'standardCost must be a decimal like "240.00".');
  }

  const barcode = get(row, 'barcode') || null;
  if (barcode) {
    if (seenInFile.barcodes.has(barcode)) {
      push('barcode', 'DUPLICATE', `Duplicate barcode "${barcode}" in file.`);
    } else if (refs.activeBarcodes.has(barcode)) {
      push('barcode', 'DUPLICATE', `Barcode "${barcode}" is already actively mapped.`);
    } else {
      seenInFile.barcodes.add(barcode);
    }
  }

  if (errors.length > 0 || !businessCategory || !trackingMethod) {
    return { data: null, errors };
  }
  return {
    data: {
      sku,
      name,
      description: get(row, 'description') || null,
      businessCategory,
      trackingMethod,
      categoryCode,
      subcategoryCode,
      brandCode,
      manufacturerCode,
      model: get(row, 'model') || null,
      baseUomCode,
      purchaseUomCode,
      issueUomCode,
      standardCost,
      barcode,
    },
    errors,
  };
}

// ------------------------------------------------------------------- lookups

export interface LookupImportRefs {
  /** Existing "CATEGORY:CODE" pairs in lookup_values. */
  existingCategoryCodes: ReadonlySet<string>;
}

export interface ValidatedLookupRow {
  /** lookup_values.category resolved from the type column. */
  category: string;
  type: LookupType;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export function validateLookupRow(
  rowNumber: number,
  row: CsvRow,
  refs: LookupImportRefs,
  seenInFile: { categoryCodes: Set<string> },
): { data: ValidatedLookupRow | null; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const push = (field: string, code: ImportRowError['code'], message: string) =>
    errors.push({ row: rowNumber, field, code, message });

  const type = get(row, 'type').toLowerCase();
  const category = LOOKUP_TYPES[type as LookupType];
  if (!type) {
    push('type', 'REQUIRED', 'type is required.');
  } else if (!category) {
    push(
      'type',
      'BAD_ENUM',
      `type must be one of ${Object.keys(LOOKUP_TYPES).join(', ')}.`,
    );
  }

  const code = get(row, 'code').toUpperCase();
  if (!code) {
    push('code', 'REQUIRED', 'code is required.');
  } else if (!CODE_PATTERN.test(code)) {
    push('code', 'BAD_FORMAT', 'code has an invalid format.');
  }
  const name = get(row, 'name');
  if (!name) {
    push('name', 'REQUIRED', 'name is required.');
  }

  if (category && code) {
    const key = `${category}:${code}`;
    if (seenInFile.categoryCodes.has(key)) {
      push('code', 'DUPLICATE', `Duplicate ${type} code "${code}" in file.`);
    } else if (refs.existingCategoryCodes.has(key)) {
      push('code', 'DUPLICATE', `A ${type} value with code "${code}" already exists.`);
    } else {
      seenInFile.categoryCodes.add(key);
    }
  }

  const sortOrderRaw = get(row, 'sortOrder');
  let sortOrder = 0;
  if (sortOrderRaw) {
    const parsed = Number(sortOrderRaw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      push('sortOrder', 'BAD_NUMBER', 'sortOrder must be a non-negative integer.');
    } else {
      sortOrder = parsed;
    }
  }

  if (errors.length > 0 || !category) {
    return { data: null, errors };
  }
  return {
    data: {
      category,
      type: type as LookupType,
      code,
      name,
      description: get(row, 'description') || null,
      sortOrder,
    },
    errors,
  };
}
