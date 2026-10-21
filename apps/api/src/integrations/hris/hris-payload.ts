/*
 * Validation of the HRIS employee feed, kept as pure functions so every
 * rejection path is unit-testable without a network or a database.
 *
 * The producer is a read-only full snapshot; the agreed contract lives in
 * docs/hris-employee-api-phase2-decisions.md. Nothing here trusts the feed:
 * a payload is either wholly acceptable or wholly rejected, because a
 * partially-applied snapshot is indistinguishable from a correct one
 * afterwards.
 */

/** The exact keys the producer may send, per the agreed allowlist. */
export const HRIS_EMPLOYEE_KEYS = [
  'hrisId',
  'employeeNumber',
  'firstName',
  'middleName',
  'lastName',
  'workEmail',
  'departmentCode',
  'positionCode',
  'employmentStatus',
  'dateHired',
  'archivedAt',
  'updatedAt',
] as const;

export type HrisEmployeeKey = (typeof HRIS_EMPLOYEE_KEYS)[number];

/** One employee exactly as the feed sends it — raw, unmapped. */
export interface HrisEmployee {
  hrisId: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  workEmail: string | null;
  departmentCode: string | null;
  positionCode: string | null;
  /** Raw producer value. GEM-ENI owns the mapping — see hris-mapping.ts. */
  employmentStatus: string;
  /** `YYYY-MM-DD`. */
  dateHired: string | null;
  /** ISO 8601 with an explicit offset, or null. */
  archivedAt: string | null;
  updatedAt: string;
}

export interface HrisPage {
  data: HrisEmployee[];
  meta: {
    companyCode: string;
    snapshot: boolean;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    generatedAt: string;
  };
}

/** Thrown for any payload the engine refuses to reconcile against. */
export class HrisPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HrisPayloadError';
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a field that must be a non-empty string.
 *
 * An empty string is rejected rather than coerced: the producer agreed to send
 * `null` for an absent value, and silently turning `""` into a real employee
 * number or name is how unusable rows get created.
 */
function requireString(
  row: Record<string, unknown>,
  key: HrisEmployeeKey,
  where: string,
): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HrisPayloadError(`${where}: ${key} must be a non-empty string`);
  }
  return value.trim();
}

/** Reads an optional field, normalising `""` to null. */
function optionalString(
  row: Record<string, unknown>,
  key: HrisEmployeeKey,
  where: string,
): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new HrisPayloadError(`${where}: ${key} must be a string or null`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Date-only (`YYYY-MM-DD`), and a real calendar date. */
function optionalDateOnly(
  row: Record<string, unknown>,
  key: HrisEmployeeKey,
  where: string,
): string | null {
  const value = optionalString(row, key, where);
  if (value === null) return null;
  if (!DATE_ONLY.test(value)) {
    throw new HrisPayloadError(`${where}: ${key} must be YYYY-MM-DD, got "${value}"`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) {
    throw new HrisPayloadError(`${where}: ${key} is not a real date ("${value}")`);
  }
  return value;
}

/**
 * A timestamp carrying an explicit zone.
 *
 * A bare local-time string is refused rather than guessed at: GEM-ENI stores
 * UTC and renders Asia/Manila, so accepting an unzoned timestamp would silently
 * shift every record by the offset.
 */
function requireInstant(
  row: Record<string, unknown>,
  key: HrisEmployeeKey,
  where: string,
): Date {
  const value = requireString(row, key, where);
  return parseInstant(value, `${where}: ${key}`);
}

function optionalInstant(
  row: Record<string, unknown>,
  key: HrisEmployeeKey,
  where: string,
): Date | null {
  const value = optionalString(row, key, where);
  if (value === null) return null;
  return parseInstant(value, `${where}: ${key}`);
}

function parseInstant(value: string, where: string): Date {
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw new HrisPayloadError(
      `${where} must be ISO 8601 with an explicit UTC offset (e.g. ...Z), got "${value}"`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HrisPayloadError(`${where} is not a valid timestamp ("${value}")`);
  }
  return parsed;
}

function requireInt(
  meta: Record<string, unknown>,
  key: string,
  where: string,
): number {
  const value = meta[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new HrisPayloadError(`${where}: meta.${key} must be a non-negative integer`);
  }
  return value;
}

/**
 * Validates one page: the envelope, the exact key allowlist on every row, and
 * each field's shape.
 *
 * `expectedCompanyCode` is checked here rather than later because a payload
 * from the wrong company must never reach reconciliation — employee numbers
 * are unique only per company in the HRIS while GEM-ENI's constraint is
 * global, so a mixed payload would collide in ways that surface far from the
 * cause.
 */
export function parseHrisPage(
  body: unknown,
  expectedCompanyCode: string,
  pageLabel = 'page',
): HrisPage {
  if (!isPlainObject(body)) {
    throw new HrisPayloadError(`${pageLabel}: response body is not an object`);
  }
  if (!Array.isArray(body.data)) {
    throw new HrisPayloadError(`${pageLabel}: response.data must be an array`);
  }
  if (!isPlainObject(body.meta)) {
    throw new HrisPayloadError(`${pageLabel}: response.meta must be an object`);
  }
  const meta = body.meta;

  if (typeof meta.companyCode !== 'string' || meta.companyCode.trim() === '') {
    throw new HrisPayloadError(`${pageLabel}: meta.companyCode is missing`);
  }
  if (meta.companyCode !== expectedCompanyCode) {
    throw new HrisPayloadError(
      `${pageLabel}: meta.companyCode is "${meta.companyCode}", expected "${expectedCompanyCode}" — ` +
        'refusing the payload rather than importing another company\'s employees',
    );
  }
  if (meta.snapshot !== true) {
    throw new HrisPayloadError(
      `${pageLabel}: meta.snapshot must be exactly true — GEM-ENI reconciles full ` +
        'snapshots only, and treating a partial feed as complete would look like deletions',
    );
  }

  const page = requireInt(meta, 'page', pageLabel);
  const pageSize = requireInt(meta, 'pageSize', pageLabel);
  const total = requireInt(meta, 'total', pageLabel);
  const totalPages = requireInt(meta, 'totalPages', pageLabel);
  if (typeof meta.generatedAt !== 'string') {
    throw new HrisPayloadError(`${pageLabel}: meta.generatedAt is missing`);
  }
  parseInstant(meta.generatedAt, `${pageLabel}: meta.generatedAt`);

  if (page < 1) {
    throw new HrisPayloadError(`${pageLabel}: meta.page must be 1-based`);
  }
  if (body.data.length > pageSize) {
    throw new HrisPayloadError(
      `${pageLabel}: ${body.data.length} rows exceeds meta.pageSize ${pageSize}`,
    );
  }
  const expectedPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  if (totalPages !== expectedPages) {
    throw new HrisPayloadError(
      `${pageLabel}: meta.totalPages ${totalPages} is inconsistent with total ${total} / pageSize ${pageSize}`,
    );
  }

  const allowed = new Set<string>(HRIS_EMPLOYEE_KEYS);
  const data = body.data.map((raw, index) => {
    const where = `${pageLabel} row ${index + 1}`;
    if (!isPlainObject(raw)) {
      throw new HrisPayloadError(`${where}: not an object`);
    }
    /*
     * Reject unknown keys outright. The producer sits on a table that is one
     * join from payroll, attendance, benefits and government identifiers, so
     * an unexpected key is treated as a contract breach to investigate rather
     * than something to quietly ignore.
     */
    const unexpected = Object.keys(raw).filter((key) => !allowed.has(key));
    if (unexpected.length > 0) {
      throw new HrisPayloadError(
        `${where}: unexpected field(s) ${unexpected.sort().join(', ')} — the feed must send ` +
          `exactly the ${HRIS_EMPLOYEE_KEYS.length} agreed keys`,
      );
    }
    for (const key of HRIS_EMPLOYEE_KEYS) {
      if (!(key in raw)) {
        throw new HrisPayloadError(`${where}: missing field ${key}`);
      }
    }

    const archivedAt = optionalInstant(raw, 'archivedAt', where);
    const updatedAt = requireInstant(raw, 'updatedAt', where);
    const employmentStatus = requireString(raw, 'employmentStatus', where);

    return {
      hrisId: requireString(raw, 'hrisId', where),
      employeeNumber: requireString(raw, 'employeeNumber', where),
      firstName: requireString(raw, 'firstName', where),
      middleName: optionalString(raw, 'middleName', where),
      lastName: requireString(raw, 'lastName', where),
      workEmail: optionalString(raw, 'workEmail', where),
      departmentCode: optionalString(raw, 'departmentCode', where),
      positionCode: optionalString(raw, 'positionCode', where),
      employmentStatus,
      dateHired: optionalDateOnly(raw, 'dateHired', where),
      archivedAt: archivedAt ? archivedAt.toISOString() : null,
      updatedAt: updatedAt.toISOString(),
    } satisfies HrisEmployee;
  });

  return {
    data,
    meta: {
      companyCode: meta.companyCode,
      snapshot: true,
      page,
      pageSize,
      total,
      totalPages,
      generatedAt: meta.generatedAt,
    },
  };
}

export interface HrisSnapshot {
  employees: HrisEmployee[];
  companyCode: string;
  total: number;
  pagesFetched: number;
  generatedAt: string;
}

/**
 * Combines validated pages into one snapshot, checking that what arrived is
 * what the producer advertised.
 *
 * A short or over-long collection means pages were dropped, duplicated or
 * shifted under us mid-pagination; reconciling it would read as spurious
 * creations and deletions, so the run is refused instead.
 */
export function combineHrisPages(pages: HrisPage[]): HrisSnapshot {
  if (pages.length === 0) {
    throw new HrisPayloadError('no pages were fetched');
  }
  const first = pages[0].meta;
  for (const [index, page] of pages.entries()) {
    if (page.meta.page !== index + 1) {
      throw new HrisPayloadError(
        `expected page ${index + 1} but meta.page says ${page.meta.page}`,
      );
    }
    if (page.meta.total !== first.total || page.meta.totalPages !== first.totalPages) {
      throw new HrisPayloadError(
        'meta.total/totalPages changed between pages — the snapshot shifted while being read',
      );
    }
  }
  if (pages.length !== first.totalPages && !(first.total === 0 && pages.length === 1)) {
    throw new HrisPayloadError(
      `fetched ${pages.length} page(s) but meta.totalPages is ${first.totalPages}`,
    );
  }

  const employees = pages.flatMap((page) => page.data);
  if (employees.length !== first.total) {
    throw new HrisPayloadError(
      `collected ${employees.length} record(s) but meta.total is ${first.total}`,
    );
  }

  /*
   * hrisId is the match key, so a duplicate makes every decision about that
   * person ambiguous. Reject the run rather than letting last-write-wins pick
   * a winner silently.
   */
  const seen = new Set<string>();
  for (const employee of employees) {
    if (seen.has(employee.hrisId)) {
      throw new HrisPayloadError(
        `duplicate hrisId "${employee.hrisId}" in the snapshot — the match key must be unique`,
      );
    }
    seen.add(employee.hrisId);
  }

  return {
    employees,
    companyCode: first.companyCode,
    total: first.total,
    pagesFetched: pages.length,
    generatedAt: first.generatedAt,
  };
}

/**
 * Employee numbers duplicated within the snapshot.
 *
 * Not fatal to the run: GEM-ENI's uniqueness is global, so the affected rows
 * are quarantined with an issue and everyone else still syncs. Returning them
 * rather than throwing is what makes that possible.
 */
export function duplicateEmployeeNumbers(employees: readonly HrisEmployee[]): Set<string> {
  const counts = new Map<string, number>();
  for (const employee of employees) {
    const key = employee.employeeNumber.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
  );
}

/** Work emails duplicated within the snapshot, compared case-insensitively. */
export function duplicateWorkEmails(employees: readonly HrisEmployee[]): Set<string> {
  const counts = new Map<string, number>();
  for (const employee of employees) {
    if (!employee.workEmail) continue;
    const key = employee.workEmail.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
  );
}
