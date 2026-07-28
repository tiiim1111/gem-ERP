import {
  EmployeeImportRefs,
  ItemImportRefs,
  LookupImportRefs,
  validateEmployeeRow,
  validateItemRow,
  validateLookupRow,
} from './import-row-validators';

function employeeRefs(overrides: Partial<EmployeeImportRefs> = {}): EmployeeImportRefs {
  return {
    branchCodes: new Set(['SUB', 'MKT']),
    accessibleBranchCodes: null,
    departmentCodes: new Set(['OPS', 'ADMIN']),
    positionCodes: new Set(['STAFF']),
    existingEmployeeNumbers: new Set(['EMP-000001']),
    existingWorkEmails: new Set(['taken@gemcor.dev']),
    ...overrides,
  };
}

function employeeRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    employeeNumber: '',
    firstName: 'Juan',
    middleName: '',
    lastName: 'Dela Cruz',
    displayName: '',
    workEmail: 'juan@gemcor.dev',
    workPhone: '',
    branchCode: 'SUB',
    departmentCode: 'OPS',
    positionCode: 'STAFF',
    supervisorEmployeeNumber: '',
    status: 'ACTIVE',
    startDate: '2026-01-15',
    ...overrides,
  };
}

describe('validateEmployeeRow', () => {
  it('accepts a fully valid row', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const result = validateEmployeeRow(1, employeeRow(), employeeRefs(), seen);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toMatchObject({
      firstName: 'Juan',
      branchCode: 'SUB',
      status: 'ACTIVE',
    });
  });

  it('reports missing required fields', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const result = validateEmployeeRow(
      2,
      employeeRow({ firstName: '', lastName: '' }),
      employeeRefs(),
      seen,
    );
    expect(result.data).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, field: 'firstName', code: 'REQUIRED' }),
        expect.objectContaining({ row: 2, field: 'lastName', code: 'REQUIRED' }),
      ]),
    );
  });

  it('reports a missing branch reference', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const result = validateEmployeeRow(
      3,
      employeeRow({ branchCode: 'XXX' }),
      employeeRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'branchCode', code: 'REF_NOT_FOUND' }),
    ]);
  });

  it('reports an out-of-scope branch for branch-limited importers', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const result = validateEmployeeRow(
      4,
      employeeRow({ branchCode: 'MKT' }),
      employeeRefs({ accessibleBranchCodes: new Set(['SUB']) }),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'branchCode', code: 'FORBIDDEN_BRANCH' }),
    ]);
  });

  it('rejects a bad status enum', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const result = validateEmployeeRow(
      5,
      employeeRow({ status: 'RETIRED' }),
      employeeRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'status', code: 'BAD_ENUM' }),
    ]);
  });

  it('rejects a malformed start date', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const result = validateEmployeeRow(
      6,
      employeeRow({ startDate: '15/01/2026' }),
      employeeRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'startDate', code: 'BAD_DATE' }),
    ]);
  });

  it('detects duplicate work emails inside the same file', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const first = validateEmployeeRow(1, employeeRow(), employeeRefs(), seen);
    const second = validateEmployeeRow(2, employeeRow(), employeeRefs(), seen);
    expect(first.errors).toHaveLength(0);
    expect(second.errors).toEqual([
      expect.objectContaining({ row: 2, field: 'workEmail', code: 'DUPLICATE' }),
    ]);
  });

  it('detects duplicates against the database', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const result = validateEmployeeRow(
      7,
      employeeRow({ employeeNumber: 'EMP-000001', workEmail: 'taken@gemcor.dev' }),
      employeeRefs(),
      seen,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'employeeNumber', code: 'DUPLICATE' }),
        expect.objectContaining({ field: 'workEmail', code: 'DUPLICATE' }),
      ]),
    );
  });

  it('requires supervisors to already exist', () => {
    const seen = { employeeNumbers: new Set<string>(), workEmails: new Set<string>() };
    const result = validateEmployeeRow(
      8,
      employeeRow({ supervisorEmployeeNumber: 'EMP-999999' }),
      employeeRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'supervisorEmployeeNumber',
        code: 'REF_NOT_FOUND',
      }),
    ]);
  });
});

function itemRefs(overrides: Partial<ItemImportRefs> = {}): ItemImportRefs {
  return {
    categoryCodes: new Set(['OFC', 'LAP']),
    subcategoryCodesByCategory: new Map([['OFC', new Set(['PPR'])]]),
    brandCodes: new Set(['HP']),
    manufacturerCodes: new Set(['HPINC']),
    uomCodes: new Set(['PC', 'BOX', 'REAM']),
    existingSkus: new Set(['SKU-OFC-00001']),
    activeBarcodes: new Set(['4800000000001']),
    ...overrides,
  };
}

function itemRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    sku: '',
    name: 'Bond Paper A4',
    description: '',
    businessCategory: 'CONSUMABLE',
    trackingMethod: 'QUANTITY',
    categoryCode: 'OFC',
    subcategoryCode: '',
    brandCode: '',
    manufacturerCode: '',
    model: '',
    baseUomCode: 'REAM',
    purchaseUomCode: 'BOX',
    issueUomCode: '',
    standardCost: '240.00',
    barcode: '',
    ...overrides,
  };
}

describe('validateItemRow', () => {
  it('accepts a fully valid row', () => {
    const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
    const result = validateItemRow(1, itemRow(), itemRefs(), seen);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toMatchObject({
      name: 'Bond Paper A4',
      businessCategory: 'CONSUMABLE',
      trackingMethod: 'QUANTITY',
    });
  });

  it('defaults the tracking method per spec §4 when omitted', () => {
    const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
    const serialized = validateItemRow(
      1,
      itemRow({ businessCategory: 'SERIALIZED_ASSET', trackingMethod: '' }),
      itemRefs(),
      seen,
    );
    expect(serialized.data?.trackingMethod).toBe('SERIAL');
  });

  it('rejects a bad businessCategory enum', () => {
    const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
    const result = validateItemRow(
      2,
      itemRow({ businessCategory: 'GADGET' }),
      itemRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'businessCategory', code: 'BAD_ENUM' }),
    ]);
  });

  it('rejects a disallowed category/tracking combo', () => {
    const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
    const result = validateItemRow(
      3,
      itemRow({ businessCategory: 'SERIALIZED_ASSET', trackingMethod: 'QUANTITY' }),
      itemRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'trackingMethod', code: 'INVALID_COMBO' }),
    ]);
  });

  it('reports missing UOM references', () => {
    const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
    const result = validateItemRow(
      4,
      itemRow({ baseUomCode: 'PALLET' }),
      itemRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'baseUomCode', code: 'REF_NOT_FOUND' }),
    ]);
  });

  it('requires a category when sku is omitted (SKU generation needs it)', () => {
    const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
    const result = validateItemRow(
      5,
      itemRow({ sku: '', categoryCode: '' }),
      itemRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'categoryCode', code: 'REQUIRED' }),
    ]);
  });

  it('detects duplicate SKUs in-file and against the database', () => {
    const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
    const dbDup = validateItemRow(6, itemRow({ sku: 'SKU-OFC-00001' }), itemRefs(), seen);
    expect(dbDup.errors).toEqual([
      expect.objectContaining({ field: 'sku', code: 'DUPLICATE' }),
    ]);

    const first = validateItemRow(7, itemRow({ sku: 'SKU-NEW-00001' }), itemRefs(), seen);
    expect(first.errors).toHaveLength(0);
    const fileDup = validateItemRow(8, itemRow({ sku: 'SKU-NEW-00001' }), itemRefs(), seen);
    expect(fileDup.errors).toEqual([
      expect.objectContaining({ row: 8, field: 'sku', code: 'DUPLICATE' }),
    ]);
  });

  it('rejects barcodes already actively mapped', () => {
    const seen = { skus: new Set<string>(), barcodes: new Set<string>() };
    const result = validateItemRow(
      9,
      itemRow({ barcode: '4800000000001' }),
      itemRefs(),
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'barcode', code: 'DUPLICATE' }),
    ]);
  });
});

describe('validateLookupRow', () => {
  const refs: LookupImportRefs = {
    existingCategoryCodes: new Set(['ASSET_CONDITION:GOOD']),
  };

  it('accepts a valid row and resolves the category', () => {
    const seen = { categoryCodes: new Set<string>() };
    const result = validateLookupRow(
      1,
      { type: 'asset-conditions', code: 'FAIR', name: 'Fair', description: '', sortOrder: '3' },
      refs,
      seen,
    );
    expect(result.errors).toHaveLength(0);
    expect(result.data).toMatchObject({
      category: 'ASSET_CONDITION',
      code: 'FAIR',
      sortOrder: 3,
    });
  });

  it('rejects unknown lookup types', () => {
    const seen = { categoryCodes: new Set<string>() };
    const result = validateLookupRow(
      2,
      { type: 'colors', code: 'RED', name: 'Red', description: '', sortOrder: '' },
      refs,
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'type', code: 'BAD_ENUM' }),
    ]);
  });

  it('detects duplicates against existing lookup values', () => {
    const seen = { categoryCodes: new Set<string>() };
    const result = validateLookupRow(
      3,
      { type: 'asset-conditions', code: 'GOOD', name: 'Good', description: '', sortOrder: '' },
      refs,
      seen,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'code', code: 'DUPLICATE' }),
    ]);
  });

  it('detects duplicates within the file', () => {
    const seen = { categoryCodes: new Set<string>() };
    const row = { type: 'disposal-methods', code: 'SOLD', name: 'Sold', description: '', sortOrder: '' };
    expect(validateLookupRow(4, row, refs, seen).errors).toHaveLength(0);
    expect(validateLookupRow(5, row, refs, seen).errors).toEqual([
      expect.objectContaining({ row: 5, field: 'code', code: 'DUPLICATE' }),
    ]);
  });
});
