'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { EmployeeStatus, PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage, isApiClientError, isVersionConflict } from '@/lib/api';
import {
  createEmployee,
  listBranches,
  listDepartments,
  listPositions,
  updateEmployee,
  type EmployeeWriteBody,
} from '@/lib/endpoints';
import { employeeName, type Employee } from '@/lib/types';
import { humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { EmployeePicker, UserPicker } from './employee-picker';

const employeeSchema = z.object({
  employeeNumber: z.string().max(40).optional().or(z.literal('')),
  firstName: z.string().min(1, 'First name is required').max(120),
  middleName: z.string().max(120),
  lastName: z.string().min(1, 'Last name is required').max(120),
  displayName: z.string().max(160),
  workEmail: z.string().email('Enter a valid email address').optional().or(z.literal('')),
  workPhone: z.string().max(40),
  branchId: z.string().min(1, 'Branch is required'),
  departmentId: z.string(),
  positionId: z.string(),
  status: z.enum([
    EmployeeStatus.ACTIVE,
    EmployeeStatus.INACTIVE,
    EmployeeStatus.SUSPENDED,
    EmployeeStatus.SEPARATED,
  ]),
  startDate: z.string(),
  notes: z.string().max(4000),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;

const FORM_FIELD_NAMES = new Set<keyof EmployeeFormValues>([
  'employeeNumber',
  'firstName',
  'middleName',
  'lastName',
  'displayName',
  'workEmail',
  'workPhone',
  'branchId',
  'departmentId',
  'positionId',
  'status',
  'startDate',
  'notes',
]);

export interface EmployeeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode. */
  employee?: Employee | null;
}

export function EmployeeFormDialog({ open, onOpenChange, employee }: EmployeeFormDialogProps) {
  const isEdit = !!employee;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useSession();
  const canViewNotes = can(PERMISSIONS.employee.viewNotes);
  const canPickUser = can(PERMISSIONS.user.view);

  const [serverError, setServerError] = React.useState<string | null>(null);
  const [supervisorId, setSupervisorId] = React.useState<string | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: ['branches', 'options'],
    queryFn: ({ signal }) => listBranches({ page: 1, pageSize: 100 }, signal),
    enabled: open,
  });
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: ({ signal }) => listDepartments({ page: 1, pageSize: 100, isActive: true }, signal),
    enabled: open,
  });
  const positionsQuery = useQuery({
    queryKey: ['positions', 'options'],
    queryFn: ({ signal }) => listPositions({ page: 1, pageSize: 100, isActive: true }, signal),
    enabled: open,
  });

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeNumber: '',
      firstName: '',
      middleName: '',
      lastName: '',
      displayName: '',
      workEmail: '',
      workPhone: '',
      branchId: '',
      departmentId: '',
      positionId: '',
      status: EmployeeStatus.ACTIVE,
      startDate: '',
      notes: '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        employeeNumber: employee?.employeeNumber ?? '',
        firstName: employee?.firstName ?? '',
        middleName: employee?.middleName ?? '',
        lastName: employee?.lastName ?? '',
        displayName: employee?.displayName ?? '',
        workEmail: employee?.workEmail ?? '',
        workPhone: employee?.workPhone ?? '',
        branchId: employee?.branchId ?? '',
        departmentId: employee?.departmentId ?? '',
        positionId: employee?.positionId ?? '',
        status: employee?.status ?? EmployeeStatus.ACTIVE,
        startDate: employee?.startDate ? employee.startDate.slice(0, 10) : '',
        notes: employee?.notes ?? '',
      });
      setSupervisorId(employee?.supervisorId ?? null);
      setUserId(employee?.userId ?? null);
      setServerError(null);
    }
  }, [open, employee, form]);

  const mutation = useMutation({
    mutationFn: async (values: EmployeeFormValues) => {
      const body: EmployeeWriteBody = {
        employeeNumber: values.employeeNumber || undefined,
        firstName: values.firstName,
        middleName: values.middleName || null,
        lastName: values.lastName,
        displayName: values.displayName || null,
        workEmail: values.workEmail || null,
        workPhone: values.workPhone || null,
        branchId: values.branchId,
        departmentId: values.departmentId || null,
        positionId: values.positionId || null,
        supervisorId: supervisorId,
        startDate: values.startDate || null,
        userId: canPickUser ? userId : undefined,
      };
      // Status transitions have dedicated action endpoints; only send status
      // when it was actually changed in the form (or on create).
      if (!isEdit || values.status !== employee?.status) {
        body.status = values.status;
      }
      if (canViewNotes) {
        body.notes = values.notes || null;
      }
      if (isEdit && employee) {
        return updateEmployee(employee.id, { ...body, version: employee.version });
      }
      return createEmployee(body);
    },
    onSuccess: (saved) => {
      toast({
        title: isEdit ? 'Employee updated' : 'Employee created',
        description: employeeName(saved),
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onOpenChange(false);
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        toast({
          title: 'Record changed',
          description: 'This employee was modified by someone else. The latest data has been reloaded — please reapply your changes.',
          variant: 'destructive',
        });
        queryClient.invalidateQueries({ queryKey: ['employees'] });
        onOpenChange(false);
        return;
      }
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (FORM_FIELD_NAMES.has(field as keyof EmployeeFormValues)) {
            form.setError(field as keyof EmployeeFormValues, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    mutation.mutate(values);
  });
  const { errors } = form.formState;
  const pending = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit employee' : 'New employee'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update the custody profile. Status changes for deactivation and separation have their own flows.'
            : 'Employees are custody records — they do not need a login account.'}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField
              label="First name"
              htmlFor="emp-first"
              error={errors.firstName?.message}
              required
            >
              <Input
                id="emp-first"
                aria-invalid={!!errors.firstName}
                data-autofocus
                {...form.register('firstName')}
              />
            </FormField>
            <FormField label="Middle name" htmlFor="emp-middle" error={errors.middleName?.message}>
              <Input id="emp-middle" {...form.register('middleName')} />
            </FormField>
            <FormField label="Last name" htmlFor="emp-last" error={errors.lastName?.message} required>
              <Input id="emp-last" aria-invalid={!!errors.lastName} {...form.register('lastName')} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Preferred name"
              htmlFor="emp-display"
              error={errors.displayName?.message}
              hint="Shown in lists when set."
            >
              <Input id="emp-display" {...form.register('displayName')} />
            </FormField>
            <FormField
              label="Employee number"
              htmlFor="emp-number"
              error={errors.employeeNumber?.message}
              hint="Leave blank to auto-generate."
            >
              <Input id="emp-number" className="font-mono" {...form.register('employeeNumber')} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Work email" htmlFor="emp-email" error={errors.workEmail?.message}>
              <Input
                id="emp-email"
                type="email"
                autoComplete="off"
                aria-invalid={!!errors.workEmail}
                {...form.register('workEmail')}
              />
            </FormField>
            <FormField label="Work phone / extension" htmlFor="emp-phone" error={errors.workPhone?.message}>
              <Input id="emp-phone" {...form.register('workPhone')} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Branch" htmlFor="emp-branch" error={errors.branchId?.message} required>
              <Select id="emp-branch" aria-invalid={!!errors.branchId} {...form.register('branchId')}>
                <option value="">Select a branch…</option>
                {(branchesQuery.data?.data ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Department" htmlFor="emp-dept" error={errors.departmentId?.message}>
              <Select id="emp-dept" {...form.register('departmentId')}>
                <option value="">No department</option>
                {(departmentsQuery.data?.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Position" htmlFor="emp-position" error={errors.positionId?.message}>
              <Select id="emp-position" {...form.register('positionId')}>
                <option value="">No position</option>
                {(positionsQuery.data?.data ?? []).map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Supervisor" htmlFor="emp-supervisor">
              <EmployeePicker
                id="emp-supervisor"
                value={supervisorId}
                onChange={setSupervisorId}
                selectedLabel={employee?.supervisor ? employeeName(employee.supervisor) : undefined}
                excludeId={employee?.id}
                placeholder="Search supervisor…"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Status" htmlFor="emp-status" error={errors.status?.message} required>
              <Select id="emp-status" {...form.register('status')}>
                {Object.values(EmployeeStatus).map((status) => (
                  <option key={status} value={status}>
                    {humanize(status)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Start date" htmlFor="emp-start" error={errors.startDate?.message}>
              <Input id="emp-start" type="date" {...form.register('startDate')} />
            </FormField>
          </div>

          {canPickUser ? (
            <FormField
              label="Linked user account"
              htmlFor="emp-user"
              hint="Optional — lets the person sign in and acknowledge their own assets."
            >
              <UserPicker
                id="emp-user"
                value={userId}
                onChange={setUserId}
                selectedLabel={employee?.user?.displayName ?? employee?.user?.email ?? undefined}
              />
            </FormField>
          ) : null}

          {canViewNotes ? (
            <FormField
              label="Notes"
              htmlFor="emp-notes"
              error={errors.notes?.message}
              hint="Restricted visibility — only users with the notes permission can read this."
            >
              <Textarea id="emp-notes" rows={3} {...form.register('notes')} />
            </FormField>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {isEdit ? 'Save changes' : 'Create employee'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
