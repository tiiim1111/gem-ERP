import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeStatus } from '@gemerp/shared';
import type { Employee } from '@/lib/types';

/** A promise whose resolution the test drives, to fix the arrival order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function page<T>(data: T[]) {
  return { data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } };
}

const BRANCH = { id: 'br-1', code: 'MNL', name: 'Manila HQ', isActive: true };
const DEPARTMENT = { id: 'dept-1', code: 'IT', name: 'Information Technology', isActive: true };
const POSITION = { id: 'pos-1', code: 'SYSAD', name: 'System Administrator', isActive: true };

/* Present only in the fetched lists, so their arrival proves a list landed. */
const LIST_ONLY_BRANCH = { id: 'br-2', code: 'CEB', name: 'Cebu', isActive: true };
const LIST_ONLY_DEPARTMENT = { id: 'dept-2', code: 'FIN', name: 'Finance', isActive: true };
const LIST_ONLY_POSITION = { id: 'pos-2', code: 'CLERK', name: 'Clerk', isActive: true };

const EMPLOYEE: Employee = {
  id: 'emp-1',
  employeeNumber: 'EMP-0001',
  firstName: 'Tim',
  lastName: 'Sinag',
  branchId: BRANCH.id,
  branch: BRANCH,
  departmentId: DEPARTMENT.id,
  department: DEPARTMENT,
  positionId: POSITION.id,
  position: POSITION,
  status: EmployeeStatus.ACTIVE,
  version: 1,
};

const lists = {
  branches: deferred<ReturnType<typeof page>>(),
  departments: deferred<ReturnType<typeof page>>(),
  positions: deferred<ReturnType<typeof page>>(),
};

vi.mock('@/lib/endpoints', () => ({
  listBranches: () => lists.branches.promise,
  listDepartments: () => lists.departments.promise,
  listPositions: () => lists.positions.promise,
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
}));

vi.mock('@/components/auth/session-provider', () => ({
  useSession: () => ({ can: () => true, user: null, refresh: vi.fn() }),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Both search on their own account and are not what this file tests.
vi.mock('./employee-picker', () => ({
  EmployeePicker: () => null,
  UserPicker: () => null,
}));

const { EmployeeFormDialog } = await import('./employee-form-dialog');

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EmployeeFormDialog open onOpenChange={vi.fn()} employee={EMPLOYEE} />
    </QueryClientProvider>,
  );
}

function field(id: string): HTMLSelectElement | HTMLInputElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`no field #${id} in the document`);
  return element as HTMLSelectElement | HTMLInputElement;
}

function optionValues(id: string): string[] {
  const element = document.getElementById(id);
  return Array.from(element?.querySelectorAll('option') ?? []).map((option) => option.value);
}

beforeEach(() => {
  for (const key of Object.keys(lists) as Array<keyof typeof lists>) {
    lists[key] = deferred();
  }
});

describe('EmployeeFormDialog hydration', () => {
  /*
   * All three lookup queries are `enabled: open`, so a first open starts them
   * in the same transition that resets the form from the employee. These are
   * uncontrolled <select>s, so the written values had no matching <option>
   * yet and the browser dropped all three. A second open was fine — the lists
   * were cached by then, which is what made it look intermittent.
   */
  it('keeps branch, department and position when the lists arrive after the open', async () => {
    renderDialog();

    await waitFor(() => expect(field('emp-number')).toHaveValue('EMP-0001'));
    expect(field('emp-branch')).toHaveValue('br-1');

    lists.branches.resolve(page([BRANCH, LIST_ONLY_BRANCH]));
    lists.departments.resolve(page([DEPARTMENT, LIST_ONLY_DEPARTMENT]));
    lists.positions.resolve(page([POSITION, LIST_ONLY_POSITION]));

    await waitFor(() => {
      expect(optionValues('emp-branch')).toContain(LIST_ONLY_BRANCH.id);
      expect(optionValues('emp-dept')).toContain(LIST_ONLY_DEPARTMENT.id);
      expect(optionValues('emp-position')).toContain(LIST_ONLY_POSITION.id);
    });

    expect(field('emp-branch')).toHaveValue('br-1');
    expect(field('emp-dept')).toHaveValue('dept-1');
    expect(field('emp-position')).toHaveValue('pos-1');
  });
});
