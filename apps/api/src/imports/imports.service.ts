import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import type { ImportStaging, Prisma } from '@prisma/client';
import { hasPermission } from '@gemerp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  EMPLOYEE_NUMBER_SEQUENCE_KEY,
  formatEmployeeNumber,
  formatSku,
  skuSequenceKey,
} from '../sequences/sequence.util';
import { BusinessCategory, TrackingMethod } from '@prisma/client';
import {
  buildTemplateCsv,
  ImportType,
  ImportTypeConfig,
  importTypeConfig,
} from './import-types';
import { parseXlsxToRows } from './xlsx';
import {
  CsvRow,
  EmployeeImportRefs,
  ImportRowError,
  ItemImportRefs,
  LookupImportRefs,
  ValidatedEmployeeRow,
  ValidatedItemRow,
  ValidatedLookupRow,
  validateEmployeeRow,
  validateItemRow,
  validateLookupRow,
} from './import-row-validators';

const MAX_ROWS = 5000;
const PREVIEW_ROWS = 10;

/** Upload metadata needed to pick the parser (CSV vs XLSX). */
export interface ImportFileInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIMES = ['text/csv', 'application/csv', 'text/plain'];

interface StagedRow<T> {
  /** 1-based data row number (header excluded). */
  row: number;
  raw: CsvRow;
  data: T | null;
  valid: boolean;
}

type AnyValidatedRow = ValidatedEmployeeRow | ValidatedItemRow | ValidatedLookupRow;

export interface ValidateResult {
  stagingId: string;
  type: ImportType;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ImportRowError[];
  /** First valid rows, as they would be written. */
  preview: AnyValidatedRow[];
}

export interface CommitRowFailure {
  row: number;
  message: string;
}

export interface CommitResult {
  stagingId: string;
  type: ImportType;
  mode: 'strict' | 'partial';
  status: string;
  created: number;
  failed: number;
  errors: CommitRowFailure[];
}

export interface StagingStatusView {
  id: string;
  type: string;
  status: string;
  totalRows: number;
  validRows: number;
  errors: ImportRowError[];
  result: unknown;
  createdById: string;
  createdAt: Date;
  committedAt: Date | null;
}

/**
 * Staged CSV/XLSX imports (spec §24): validate first (no writes), commit
 * explicitly. `mode: "strict"` is all-or-nothing; `mode: "partial"` writes
 * valid rows only — invalid rows are never imported silently.
 *
 * Permissions are per import type (`<resource>.import`), so they are enforced
 * here rather than by the static @RequirePermissions decorator.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  /** Per-type permission gate (super admins bypass, never the audit trail). */
  assertPermission(user: AuthUser, type: string): ImportTypeConfig {
    const config = importTypeConfig(type);
    if (!user.isSuperAdmin && !hasPermission(user.permissions, config.permission)) {
      throw AppException.forbidden();
    }
    return config;
  }

  templateCsv(user: AuthUser, type: string): string {
    this.assertPermission(user, type);
    return buildTemplateCsv(type);
  }

  // ---------------------------------------------------------------- validate

  async validate(
    user: AuthUser,
    type: string,
    file: ImportFileInput,
    ctx: AuditContext,
  ): Promise<ValidateResult> {
    const config = this.assertPermission(user, type);
    const importType = type as ImportType;
    const records = await this.parseUpload(file, config);

    let staged: StagedRow<AnyValidatedRow>[];
    let errors: ImportRowError[];
    switch (importType) {
      case 'employees': {
        const refs = await this.loadEmployeeRefs(user);
        const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
        ({ staged, errors } = this.runValidation(records, (rowNumber, row) =>
          validateEmployeeRow(rowNumber, row, refs, seen),
        ));
        break;
      }
      case 'items': {
        const refs = await this.loadItemRefs();
        const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
        ({ staged, errors } = this.runValidation(records, (rowNumber, row) =>
          validateItemRow(rowNumber, row, refs, seen),
        ));
        break;
      }
      case 'lookups': {
        const refs = await this.loadLookupRefs();
        const seen = { categoryCodes: new Set<string>() };
        ({ staged, errors } = this.runValidation(records, (rowNumber, row) =>
          validateLookupRow(rowNumber, row, refs, seen),
        ));
        break;
      }
    }

    const validRows = staged.filter((row) => row.valid).length;
    const staging = await this.prisma.importStaging.create({
      data: {
        type: importType,
        status: 'VALIDATED',
        totalRows: staged.length,
        validRows,
        rows: staged as unknown as Prisma.InputJsonValue,
        errors: errors as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
      select: { id: true },
    });

    await this.audit.log({
      action: 'import.validated',
      resourceType: 'import',
      resourceId: staging.id,
      metadata: { type: importType, totalRows: staged.length, validRows },
      ...ctx,
    });
    return {
      stagingId: staging.id,
      type: importType,
      totalRows: staged.length,
      validRows,
      invalidRows: staged.length - validRows,
      errors,
      preview: staged
        .filter((row) => row.valid && row.data !== null)
        .slice(0, PREVIEW_ROWS)
        .map((row) => row.data as AnyValidatedRow),
    };
  }

  // ------------------------------------------------------------------ commit

  async commit(
    user: AuthUser,
    type: string,
    stagingId: string,
    mode: 'strict' | 'partial',
    ctx: AuditContext,
  ): Promise<CommitResult> {
    this.assertPermission(user, type);
    const importType = type as ImportType;

    const staging = await this.prisma.importStaging.findUnique({
      where: { id: stagingId },
    });
    if (!staging || staging.type !== importType) {
      throw AppException.notFound('Import staging not found.');
    }
    if (staging.status !== 'VALIDATED') {
      throw AppException.invalidStateTransition(
        `This staging has already been committed (status ${staging.status}).`,
      );
    }

    const rows = staging.rows as unknown as StagedRow<AnyValidatedRow>[];
    const validRows = rows.filter((row) => row.valid && row.data !== null);
    if (validRows.length === 0) {
      throw AppException.invalidStateTransition(
        'This staging has no valid rows to commit. Fix the file and validate again.',
      );
    }
    if (mode === 'strict' && validRows.length !== staging.totalRows) {
      throw AppException.invalidStateTransition(
        `Strict commit refused: ${staging.totalRows - validRows.length} invalid row(s). ` +
          'Fix the file, or commit with mode "partial" to import valid rows only.',
      );
    }

    const writer = await this.buildWriter(user, importType);
    let created = 0;
    const failures: CommitRowFailure[] = [];

    if (mode === 'strict') {
      // All-or-nothing: one transaction, any failure rolls everything back.
      await this.prisma.$transaction(async (tx) => {
        for (const row of validRows) {
          await writer(tx, row.data as AnyValidatedRow);
          created += 1;
        }
      });
    } else {
      // Partial: each row commits alone; failures are reported, never written.
      for (const row of validRows) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await writer(tx, row.data as AnyValidatedRow);
          });
          created += 1;
        } catch (error) {
          failures.push({ row: row.row, message: this.rowErrorMessage(error) });
        }
      }
    }

    const status =
      failures.length === 0
        ? 'COMMITTED'
        : created > 0
          ? 'PARTIALLY_COMMITTED'
          : 'FAILED';
    const result = {
      mode,
      created,
      failed: failures.length,
      errors: failures,
    };
    await this.prisma.importStaging.update({
      where: { id: staging.id },
      data: {
        status,
        committedAt: new Date(),
        result: result as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      action: 'import.committed',
      resourceType: 'import',
      resourceId: staging.id,
      newValues: { type: importType, mode, created, failed: failures.length },
      ...ctx,
    });
    return {
      stagingId: staging.id,
      type: importType,
      mode,
      status,
      created,
      failed: failures.length,
      errors: failures,
    };
  }

  async getById(user: AuthUser, id: string): Promise<StagingStatusView> {
    const staging = await this.prisma.importStaging.findUnique({ where: { id } });
    if (!staging) {
      throw AppException.notFound('Import staging not found.');
    }
    this.assertPermission(user, staging.type);
    return this.toStatusView(staging);
  }

  // ----------------------------------------------------------------- parsing

  /**
   * Pick the parser from the upload's extension/MIME type (CSV or XLSX),
   * then run the shared row/header validation. Unknown formats are rejected
   * up front — never guessed at.
   */
  private async parseUpload(
    file: ImportFileInput,
    config: ImportTypeConfig,
  ): Promise<CsvRow[]> {
    const name = (file.originalName ?? '').toLowerCase();
    const mime = (file.mimeType ?? '').toLowerCase();

    let records: CsvRow[];
    if (name.endsWith('.xlsx') || mime === XLSX_MIME) {
      records = await parseXlsxToRows(file.buffer);
    } else if (
      name.endsWith('.csv') ||
      CSV_MIMES.includes(mime) ||
      // Legacy callers that never declared a type keep the CSV behavior.
      (name === '' && mime === '')
    ) {
      records = this.parseCsv(file.buffer);
    } else {
      throw AppException.validation([
        {
          field: 'file',
          message: 'Unsupported file type. Upload a .csv or .xlsx file.',
        },
      ]);
    }
    return this.checkRecords(records, config);
  }

  private parseCsv(buffer: Buffer): CsvRow[] {
    try {
      return parse(buffer, {
        columns: true,
        bom: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as CsvRow[];
    } catch {
      throw AppException.validation([
        { field: 'file', message: 'The file is not parseable CSV.' },
      ]);
    }
  }

  /** Format-independent sanity checks shared by the CSV and XLSX paths. */
  private checkRecords(records: CsvRow[], config: ImportTypeConfig): CsvRow[] {
    if (records.length === 0) {
      throw AppException.validation([
        { field: 'file', message: 'The file contains no data rows.' },
      ]);
    }
    if (records.length > MAX_ROWS) {
      throw AppException.validation([
        { field: 'file', message: `The file exceeds the ${MAX_ROWS}-row limit.` },
      ]);
    }
    const presentHeaders = new Set(Object.keys(records[0]));
    const missing = config.headers.filter((header) => !presentHeaders.has(header));
    if (missing.length > 0) {
      throw AppException.validation([
        {
          field: 'file',
          message: `Missing column(s): ${missing.join(', ')}. Download the template for the expected format.`,
        },
      ]);
    }
    return records;
  }

  private runValidation<T extends AnyValidatedRow>(
    records: CsvRow[],
    validateRow: (
      rowNumber: number,
      row: CsvRow,
    ) => { data: T | null; errors: ImportRowError[] },
  ): { staged: StagedRow<AnyValidatedRow>[]; errors: ImportRowError[] } {
    const staged: StagedRow<AnyValidatedRow>[] = [];
    const errors: ImportRowError[] = [];
    records.forEach((record, index) => {
      const rowNumber = index + 1;
      const { data, errors: rowErrors } = validateRow(rowNumber, record);
      errors.push(...rowErrors);
      staged.push({
        row: rowNumber,
        raw: record,
        data,
        valid: rowErrors.length === 0 && data !== null,
      });
    });
    return { staged, errors };
  }

  // ------------------------------------------------------- reference loading

  private async loadEmployeeRefs(user: AuthUser): Promise<EmployeeImportRefs> {
    const [branches, departments, positions, employees] = await Promise.all([
      this.prisma.branch.findMany({ select: { id: true, code: true } }),
      this.prisma.department.findMany({
        where: { isActive: true },
        select: { code: true },
      }),
      this.prisma.position.findMany({
        where: { isActive: true },
        select: { code: true },
      }),
      this.prisma.employee.findMany({
        select: { employeeNumber: true, workEmail: true },
      }),
    ]);
    const accessible = user.isSuperAdmin
      ? null
      : new Set(
          branches
            .filter((branch) => user.branchIds.includes(branch.id))
            .map((branch) => branch.code),
        );
    return {
      branchCodes: new Set(branches.map((branch) => branch.code)),
      accessibleBranchCodes: accessible,
      departmentCodes: new Set(departments.map((department) => department.code)),
      positionCodes: new Set(positions.map((position) => position.code)),
      existingEmployeeNumbers: new Set(
        employees.map((employee) => employee.employeeNumber),
      ),
      existingWorkEmails: new Set(
        employees
          .map((employee) => employee.workEmail?.toLowerCase())
          .filter((email): email is string => Boolean(email)),
      ),
    };
  }

  private async loadItemRefs(): Promise<ItemImportRefs> {
    const [categories, subcategories, brands, manufacturers, uoms, items, barcodes] =
      await Promise.all([
        this.prisma.itemCategory.findMany({ select: { id: true, code: true } }),
        this.prisma.itemSubcategory.findMany({
          select: { code: true, category: { select: { code: true } } },
        }),
        this.prisma.brand.findMany({ select: { code: true } }),
        this.prisma.manufacturer.findMany({ select: { code: true } }),
        this.prisma.unitOfMeasure.findMany({ select: { code: true } }),
        this.prisma.item.findMany({ select: { sku: true } }),
        this.prisma.itemBarcode.findMany({
          where: { active: true },
          select: { barcode: true },
        }),
      ]);
    const subcategoryMap = new Map<string, Set<string>>();
    for (const subcategory of subcategories) {
      const set = subcategoryMap.get(subcategory.category.code) ?? new Set<string>();
      set.add(subcategory.code);
      subcategoryMap.set(subcategory.category.code, set);
    }
    return {
      categoryCodes: new Set(categories.map((category) => category.code)),
      subcategoryCodesByCategory: subcategoryMap,
      brandCodes: new Set(brands.map((brand) => brand.code)),
      manufacturerCodes: new Set(
        manufacturers.map((manufacturer) => manufacturer.code),
      ),
      uomCodes: new Set(uoms.map((uom) => uom.code)),
      existingSkus: new Set(items.map((item) => item.sku)),
      activeBarcodes: new Set(barcodes.map((barcode) => barcode.barcode)),
    };
  }

  private async loadLookupRefs(): Promise<LookupImportRefs> {
    const values = await this.prisma.lookupValue.findMany({
      select: { category: true, code: true },
    });
    return {
      existingCategoryCodes: new Set(
        values.map((value) => `${value.category}:${value.code}`),
      ),
    };
  }

  // ------------------------------------------------------------ row writers

  private async buildWriter(
    user: AuthUser,
    type: ImportType,
  ): Promise<(tx: Prisma.TransactionClient, data: AnyValidatedRow) => Promise<void>> {
    switch (type) {
      case 'employees': {
        const [branches, departments, positions] = await Promise.all([
          this.prisma.branch.findMany({ select: { id: true, code: true } }),
          this.prisma.department.findMany({ select: { id: true, code: true } }),
          this.prisma.position.findMany({ select: { id: true, code: true } }),
        ]);
        const branchIds = new Map(branches.map((b) => [b.code, b.id]));
        const departmentIds = new Map(departments.map((d) => [d.code, d.id]));
        const positionIds = new Map(positions.map((p) => [p.code, p.id]));

        return async (tx, row) => {
          const data = row as ValidatedEmployeeRow;
          const branchId = branchIds.get(data.branchCode);
          if (!branchId) {
            throw new Error(`Branch "${data.branchCode}" no longer exists.`);
          }
          if (!user.isSuperAdmin && !user.branchIds.includes(branchId)) {
            throw new Error(`No access to branch "${data.branchCode}".`);
          }
          let supervisorId: string | null = null;
          if (data.supervisorEmployeeNumber) {
            const supervisor = await tx.employee.findUnique({
              where: { employeeNumber: data.supervisorEmployeeNumber },
              select: { id: true },
            });
            if (!supervisor) {
              throw new Error(
                `Supervisor "${data.supervisorEmployeeNumber}" no longer exists.`,
              );
            }
            supervisorId = supervisor.id;
          }
          const employeeNumber =
            data.employeeNumber ??
            formatEmployeeNumber(
              await this.sequences.next(tx, EMPLOYEE_NUMBER_SEQUENCE_KEY),
            );
          await tx.employee.create({
            data: {
              employeeNumber,
              firstName: data.firstName,
              middleName: data.middleName,
              lastName: data.lastName,
              displayName: data.displayName,
              workEmail: data.workEmail,
              workPhone: data.workPhone,
              branchId,
              departmentId: data.departmentCode
                ? (departmentIds.get(data.departmentCode) ?? null)
                : null,
              positionId: data.positionCode
                ? (positionIds.get(data.positionCode) ?? null)
                : null,
              supervisorId,
              status: data.status,
              startDate: data.startDate ? new Date(data.startDate) : null,
            },
          });
        };
      }
      case 'items': {
        const [categories, subcategories, brands, manufacturers, uoms] =
          await Promise.all([
            this.prisma.itemCategory.findMany({ select: { id: true, code: true } }),
            this.prisma.itemSubcategory.findMany({
              select: { id: true, code: true, category: { select: { code: true } } },
            }),
            this.prisma.brand.findMany({ select: { id: true, code: true } }),
            this.prisma.manufacturer.findMany({ select: { id: true, code: true } }),
            this.prisma.unitOfMeasure.findMany({ select: { id: true, code: true } }),
          ]);
        const categoryIds = new Map(categories.map((c) => [c.code, c.id]));
        const subcategoryIds = new Map(
          subcategories.map((s) => [`${s.category.code}:${s.code}`, s.id]),
        );
        const brandIds = new Map(brands.map((b) => [b.code, b.id]));
        const manufacturerIds = new Map(manufacturers.map((m) => [m.code, m.id]));
        const uomIds = new Map(uoms.map((u) => [u.code, u.id]));

        return async (tx, row) => {
          const data = row as ValidatedItemRow;
          const baseUomId = uomIds.get(data.baseUomCode);
          if (!baseUomId) {
            throw new Error(`UOM "${data.baseUomCode}" no longer exists.`);
          }
          const sku =
            data.sku ??
            formatSku(
              data.categoryCode as string,
              await this.sequences.next(
                tx,
                skuSequenceKey(data.categoryCode as string),
              ),
            );
          const isSerial = data.trackingMethod === TrackingMethod.SERIAL;
          const item = await tx.item.create({
            data: {
              sku,
              name: data.name,
              description: data.description,
              businessCategory: data.businessCategory,
              trackingMethod: data.trackingMethod,
              categoryId: data.categoryCode
                ? (categoryIds.get(data.categoryCode) ?? null)
                : null,
              subcategoryId:
                data.categoryCode && data.subcategoryCode
                  ? (subcategoryIds.get(
                      `${data.categoryCode}:${data.subcategoryCode}`,
                    ) ?? null)
                  : null,
              brandId: data.brandCode ? (brandIds.get(data.brandCode) ?? null) : null,
              manufacturerId: data.manufacturerCode
                ? (manufacturerIds.get(data.manufacturerCode) ?? null)
                : null,
              model: data.model,
              baseUomId,
              purchaseUomId: data.purchaseUomCode
                ? (uomIds.get(data.purchaseUomCode) ?? null)
                : null,
              issueUomId: data.issueUomCode
                ? (uomIds.get(data.issueUomCode) ?? null)
                : null,
              standardCost: data.standardCost,
              isLotTracked: data.trackingMethod === TrackingMethod.LOT,
              requiresSerialNumber: isSerial,
              isMaintainable:
                isSerial &&
                data.businessCategory === BusinessCategory.SERIALIZED_ASSET,
            },
            select: { id: true },
          });
          if (data.barcode) {
            await tx.itemBarcode.create({
              data: {
                itemId: item.id,
                barcode: data.barcode,
                barcodeType: 'INTERNAL',
                isPrimary: true,
              },
            });
          }
        };
      }
      case 'lookups':
        return async (tx, row) => {
          const data = row as ValidatedLookupRow;
          await tx.lookupValue.create({
            data: {
              category: data.category,
              code: data.code,
              name: data.name,
              description: data.description,
              sortOrder: data.sortOrder,
            },
          });
        };
    }
  }

  /** Safe per-row failure message (unique conflicts get a friendly text). */
  private rowErrorMessage(error: unknown): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    ) {
      return 'A record with the same unique value already exists.';
    }
    return error instanceof Error ? error.message : 'Row could not be written.';
  }

  private toStatusView(staging: ImportStaging): StagingStatusView {
    return {
      id: staging.id,
      type: staging.type,
      status: staging.status,
      totalRows: staging.totalRows,
      validRows: staging.validRows,
      errors: staging.errors as unknown as ImportRowError[],
      result: staging.result,
      createdById: staging.createdById,
      createdAt: staging.createdAt,
      committedAt: staging.committedAt,
    };
  }
}
