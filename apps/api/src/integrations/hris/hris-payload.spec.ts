import {
  combineHrisPages,
  duplicateEmployeeNumbers,
  duplicateWorkEmails,
  HRIS_EMPLOYEE_KEYS,
  HrisPayloadError,
  parseHrisPage,
} from './hris-payload';

/*
 * The feed sits on a table one join from payroll, attendance, benefits and
 * government identifiers, and a half-applied snapshot is indistinguishable
 * from a correct one afterwards. So these tests are mostly about what the
 * parser REFUSES.
 */

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hrisId: 'hris-1',
    employeeNumber: 'GC-0001',
    firstName: 'Ana',
    middleName: null,
    lastName: 'Reyes',
    workEmail: null,
    departmentCode: 'ADMIN',
    positionCode: 'ITO',
    employmentStatus: 'ACTIVE',
    dateHired: '2024-03-04',
    archivedAt: null,
    updatedAt: '2026-10-20T06:12:44Z',
    ...overrides,
  };
}

function page(
  data: Array<Record<string, unknown>>,
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    data,
    meta: {
      companyCode: 'GEM',
      snapshot: true,
      page: 1,
      pageSize: 200,
      total: data.length,
      totalPages: data.length === 0 ? 0 : 1,
      generatedAt: '2026-10-21T01:30:00Z',
      ...meta,
    },
  };
}

describe('parseHrisPage', () => {
  it('accepts the agreed contract', () => {
    const parsed = parseHrisPage(page([row()]), 'GEM');
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].employeeNumber).toBe('GC-0001');
    expect(parsed.meta.companyCode).toBe('GEM');
  });

  it('has exactly twelve agreed keys', () => {
    // Guards the allowlist itself against drifting out of step with the
    // contract in docs/hris-employee-api-phase2-decisions.md.
    expect(HRIS_EMPLOYEE_KEYS).toHaveLength(12);
  });

  describe('the field allowlist', () => {
    /*
     * The point of the allowlist: a column added to the HRIS employee table
     * must not be able to reach GEM-ENI silently. Rejecting is what makes a
     * contract breach visible instead of invisible.
     */
    it.each([
      ['birthDate', '1990-01-01'],
      ['address', '12 Mabini St'],
      ['contactNumber', '+63 917 000 0000'],
      ['salary', 45000],
      ['sssNumber', '34-1234567-8'],
      ['passwordHash', '$argon2id$...'],
    ])('rejects an unexpected %s field', (key, value) => {
      expect(() => parseHrisPage(page([row({ [key]: value })]), 'GEM')).toThrow(
        /unexpected field/i,
      );
    });

    it('names every unexpected field so the breach can be traced', () => {
      expect(() =>
        parseHrisPage(page([row({ salary: 1, birthDate: '1990-01-01' })]), 'GEM'),
      ).toThrow(/birthDate, salary/);
    });

    it('rejects a missing field rather than defaulting it', () => {
      const incomplete = row();
      delete incomplete.departmentCode;
      expect(() => parseHrisPage(page([incomplete]), 'GEM')).toThrow(
        /missing field departmentCode/,
      );
    });
  });

  describe('the company guard', () => {
    /*
     * Employee numbers are unique only per company in the HRIS while
     * GEM-ENI's constraint is global, so a payload from another company would
     * both import strangers and collide — surfacing far from the cause.
     */
    it('refuses a payload from the wrong company', () => {
      expect(() => parseHrisPage(page([row()], { companyCode: 'OTHER' }), 'GEM')).toThrow(
        /expected "GEM"/,
      );
    });

    it('refuses a missing company code', () => {
      expect(() => parseHrisPage(page([row()], { companyCode: '' }), 'GEM')).toThrow(
        /companyCode is missing/,
      );
    });
  });

  describe('the snapshot guard', () => {
    it.each([[false], ['true'], [undefined], [null]])(
      'refuses meta.snapshot = %p',
      (snapshot) => {
        expect(() => parseHrisPage(page([row()], { snapshot }), 'GEM')).toThrow(
          /snapshot must be exactly true/,
        );
      },
    );
  });

  describe('timestamps', () => {
    /*
     * GEM-ENI stores UTC and renders Asia/Manila. An unzoned timestamp would
     * silently shift every record by the offset, so it is refused rather than
     * guessed at.
     */
    it('refuses updatedAt without an offset', () => {
      expect(() => parseHrisPage(page([row({ updatedAt: '2026-10-20 06:12:44' })]), 'GEM')).toThrow(
        /explicit UTC offset/,
      );
    });

    it('accepts a non-UTC offset and normalises it', () => {
      const parsed = parseHrisPage(page([row({ updatedAt: '2026-10-20T14:12:44+08:00' })]), 'GEM');
      expect(parsed.data[0].updatedAt).toBe('2026-10-20T06:12:44.000Z');
    });

    it('refuses an unparseable timestamp', () => {
      expect(() => parseHrisPage(page([row({ updatedAt: 'yesterdayZ' })]), 'GEM')).toThrow(
        HrisPayloadError,
      );
    });

    it('requires hire dates to be date-only', () => {
      expect(() =>
        parseHrisPage(page([row({ dateHired: '2024-03-04T00:00:00Z' })]), 'GEM'),
      ).toThrow(/must be YYYY-MM-DD/);
    });

    it('refuses a date that does not exist', () => {
      expect(() => parseHrisPage(page([row({ dateHired: '2024-02-31' })]), 'GEM')).toThrow(
        /not a real date/,
      );
    });
  });

  describe('empty strings', () => {
    /*
     * The producer agreed to send null. Coercing "" into a real value is how
     * employees with blank names and unusable numbers get created.
     */
    it('refuses an empty required field', () => {
      expect(() => parseHrisPage(page([row({ firstName: '   ' })]), 'GEM')).toThrow(
        /firstName must be a non-empty string/,
      );
    });

    it('normalises an empty optional field to null', () => {
      const parsed = parseHrisPage(page([row({ middleName: '', workEmail: '  ' })]), 'GEM');
      expect(parsed.data[0].middleName).toBeNull();
      expect(parsed.data[0].workEmail).toBeNull();
    });
  });

  describe('envelope consistency', () => {
    it('refuses totalPages that disagrees with total and pageSize', () => {
      expect(() => parseHrisPage(page([row()], { total: 500, totalPages: 1 }), 'GEM')).toThrow(
        /inconsistent/,
      );
    });

    it('refuses more rows than the advertised page size', () => {
      expect(() =>
        parseHrisPage(page([row(), row({ hrisId: 'hris-2' })], { pageSize: 1, total: 2, totalPages: 2 }), 'GEM'),
      ).toThrow(/exceeds meta.pageSize/);
    });

    it('accepts an empty snapshot', () => {
      const parsed = parseHrisPage(page([]), 'GEM');
      expect(parsed.data).toHaveLength(0);
    });
  });
});

describe('combineHrisPages', () => {
  const twoPageMeta = { pageSize: 1, total: 2, totalPages: 2 };

  it('joins pages in order', () => {
    const first = parseHrisPage(page([row()], { ...twoPageMeta, page: 1 }), 'GEM');
    const second = parseHrisPage(
      page([row({ hrisId: 'hris-2', employeeNumber: 'GC-0002' })], { ...twoPageMeta, page: 2 }),
      'GEM',
    );
    const snapshot = combineHrisPages([first, second]);
    expect(snapshot.total).toBe(2);
    expect(snapshot.pagesFetched).toBe(2);
    expect(snapshot.employees.map((e) => e.hrisId)).toEqual(['hris-1', 'hris-2']);
  });

  /*
   * A short or long collection means pages were dropped, duplicated or shifted
   * mid-pagination. Reconciling that would read as spurious creations and
   * departures, so the run is refused.
   */
  it('refuses a short collection', () => {
    const only = parseHrisPage(page([row()], { ...twoPageMeta, page: 1 }), 'GEM');
    expect(() => combineHrisPages([only])).toThrow(/totalPages is 2/);
  });

  it('refuses a total that changed between pages', () => {
    const first = parseHrisPage(page([row()], { ...twoPageMeta, page: 1 }), 'GEM');
    const second = parseHrisPage(
      page([row({ hrisId: 'hris-2' })], { pageSize: 1, total: 3, totalPages: 3, page: 2 }),
      'GEM',
    );
    expect(() => combineHrisPages([first, second])).toThrow(/snapshot shifted/);
  });

  it('refuses pages out of order', () => {
    const second = parseHrisPage(page([row()], { ...twoPageMeta, page: 2 }), 'GEM');
    expect(() => combineHrisPages([second])).toThrow(/expected page 1/);
  });

  /*
   * hrisId is the match key, so a duplicate makes every decision about that
   * person ambiguous — last-write-wins must not pick a winner quietly.
   */
  it('refuses a duplicate hrisId', () => {
    const dup = parseHrisPage(
      page([row(), row({ employeeNumber: 'GC-0002' })], { pageSize: 2, total: 2, totalPages: 1 }),
      'GEM',
    );
    expect(() => combineHrisPages([dup])).toThrow(/duplicate hrisId/);
  });

  it('refuses no pages at all', () => {
    expect(() => combineHrisPages([])).toThrow(/no pages/);
  });
});

describe('duplicate detection within a snapshot', () => {
  /*
   * These are returned rather than thrown: GEM-ENI's uniqueness is global, so
   * the affected rows are quarantined while everyone else still syncs.
   */
  it('finds duplicate employee numbers case-insensitively', () => {
    const parsed = parseHrisPage(
      page([row(), row({ hrisId: 'hris-2', employeeNumber: 'gc-0001' })], {
        pageSize: 2,
        total: 2,
        totalPages: 1,
      }),
      'GEM',
    );
    expect(duplicateEmployeeNumbers(parsed.data)).toEqual(new Set(['GC-0001']));
  });

  it('finds shared work emails case-insensitively', () => {
    const parsed = parseHrisPage(
      page(
        [
          row({ workEmail: 'Admin@gemcor.ph' }),
          row({ hrisId: 'hris-2', employeeNumber: 'GC-0002', workEmail: 'admin@gemcor.ph' }),
        ],
        { pageSize: 2, total: 2, totalPages: 1 },
      ),
      'GEM',
    );
    expect(duplicateWorkEmails(parsed.data)).toEqual(new Set(['admin@gemcor.ph']));
  });

  it('does not treat absent emails as duplicates of each other', () => {
    const parsed = parseHrisPage(
      page([row(), row({ hrisId: 'hris-2', employeeNumber: 'GC-0002' })], {
        pageSize: 2,
        total: 2,
        totalPages: 1,
      }),
      'GEM',
    );
    expect(duplicateWorkEmails(parsed.data).size).toBe(0);
  });
});
