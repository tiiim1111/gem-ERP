import { describe, expect, it } from 'vitest';
import {
  assetHolderIsEmployee,
  assetHolderLabel,
  assignmentExpectsAcknowledgement,
  assignmentTargetLabel,
  type Asset,
  type AssetAssignment,
} from './types';

/*
 * An asset can be assigned to five different things. The custody table used to
 * read only three of them, so an asset held by a named non-employee showed a
 * dash — it looked unassigned while someone was holding it. That is the whole
 * reason these are shared helpers with tests rather than inline conditionals
 * repeated per screen.
 */

function assignment(overrides: Partial<AssetAssignment> = {}): AssetAssignment {
  return { id: 'assign-1', ...overrides };
}

describe('assignmentTargetLabel', () => {
  it('names an employee', () => {
    expect(
      assignmentTargetLabel(
        assignment({
          employee: { id: 'emp-1', firstName: 'Ana', lastName: 'Reyes' } as never,
        }),
      ),
    ).toBe('Ana Reyes');
  });

  it('names a custodian who has no employee record', () => {
    expect(assignmentTargetLabel(assignment({ assigneeName: 'Leo Hernandez' }))).toBe(
      'Leo Hernandez',
    );
  });

  it('names a department', () => {
    expect(
      assignmentTargetLabel(assignment({ department: { id: 'd-1', name: 'Administration' } })),
    ).toBe('Administration');
  });

  it('names a storage location', () => {
    expect(
      assignmentTargetLabel(assignment({ location: { id: 'l-1', name: 'Admin Office' } as never })),
    ).toBe('Admin Office');
  });

  it('names a project', () => {
    expect(assignmentTargetLabel(assignment({ projectRef: 'CCTV Upgrade 2026' }))).toBe(
      'CCTV Upgrade 2026',
    );
  });

  /* An employee record outranks a leftover typed name from an earlier hand-over. */
  it('prefers the employee when both are present', () => {
    expect(
      assignmentTargetLabel(
        assignment({
          employee: { id: 'emp-1', firstName: 'Ana', lastName: 'Reyes' } as never,
          assigneeName: 'Leo Hernandez',
        }),
      ),
    ).toBe('Ana Reyes');
  });

  it('falls back to a dash only when there is genuinely no target', () => {
    expect(assignmentTargetLabel(assignment())).toBe('—');
  });

  /* Empty strings are not targets; they would read as an assignment to nobody. */
  it('ignores an empty name', () => {
    expect(assignmentTargetLabel(assignment({ assigneeName: '' }))).toBe('—');
  });
});

describe('assignmentExpectsAcknowledgement', () => {
  /*
   * Only a person with an account can sign for an asset. Showing "Pending" on
   * the others is waiting on something that can never happen, which makes a
   * complete custody record look permanently unfinished.
   */
  it('is true for an employee', () => {
    expect(
      assignmentExpectsAcknowledgement(
        assignment({ employee: { id: 'emp-1', firstName: 'Ana', lastName: 'Reyes' } as never }),
      ),
    ).toBe(true);
  });

  it('is true when only the employee id came back', () => {
    expect(assignmentExpectsAcknowledgement(assignment({ employeeId: 'emp-1' }))).toBe(true);
  });

  it.each([
    ['a typed name', { assigneeName: 'Leo Hernandez' }],
    ['a department', { department: { id: 'd-1', name: 'Administration' } }],
    ['a project', { projectRef: 'CCTV Upgrade 2026' }],
  ])('is false for %s', (_label, overrides) => {
    expect(assignmentExpectsAcknowledgement(assignment(overrides as Partial<AssetAssignment>))).toBe(
      false,
    );
  });
});

/*
 * The same shape one level up: who currently holds the asset. The list grid
 * read only the employee relation while the detail had been fixed, so a held
 * asset showed a dash on one screen and a name on the other.
 */
function asset(overrides: Partial<Asset> = {}): Asset {
  return { id: 'asset-1', ...overrides } as Asset;
}

describe('assetHolderLabel', () => {
  it('names the custodian employee', () => {
    expect(
      assetHolderLabel(
        asset({ custodian: { id: 'emp-1', firstName: 'Ana', lastName: 'Reyes' } as never }),
      ),
    ).toBe('Ana Reyes');
  });

  it('names a holder with no employee record', () => {
    expect(assetHolderLabel(asset({ custodianName: 'Leo Hernandez' }))).toBe('Leo Hernandez');
  });

  it('is null when nobody holds it', () => {
    expect(assetHolderLabel(asset())).toBeNull();
  });

  /* A stale empty string must not read as a holder. */
  it('treats an empty name as nobody', () => {
    expect(assetHolderLabel(asset({ custodianName: '' }))).toBeNull();
  });

  it('prefers the employee record over a leftover name', () => {
    expect(
      assetHolderLabel(
        asset({
          custodian: { id: 'emp-1', firstName: 'Ana', lastName: 'Reyes' } as never,
          custodianName: 'Leo Hernandez',
        }),
      ),
    ).toBe('Ana Reyes');
  });
});

describe('assetHolderIsEmployee', () => {
  it('is true for an employee custodian', () => {
    expect(
      assetHolderIsEmployee(
        asset({ custodian: { id: 'emp-1', firstName: 'Ana', lastName: 'Reyes' } as never }),
      ),
    ).toBe(true);
  });

  it('is false for a typed name, which drives the "not an employee" marker', () => {
    expect(assetHolderIsEmployee(asset({ custodianName: 'Leo Hernandez' }))).toBe(false);
  });
});
