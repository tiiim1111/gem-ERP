'use client';

import * as React from 'react';
import { PERMISSIONS } from '@gemerp/shared';
import {
  createBrand,
  createDepartment,
  createLookupValue,
  createManufacturer,
  createPosition,
  createUom,
  listBrands,
  listDepartments,
  listLookupValues,
  listManufacturers,
  listPositions,
  listUoms,
  updateBrand,
  updateDepartment,
  updateLookupValue,
  updateManufacturer,
  updatePosition,
  updateUom,
  type LookupType,
} from '@/lib/endpoints';
import { employeeName, type Department } from '@/lib/types';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { CategoriesTab } from './categories-tab';
import { ConversionsTab } from './conversions-tab';
import { LookupSection } from './lookup-section';

/** "Other lists" — the generic /lookups/:type value lists. */
const OTHER_LOOKUP_TYPES: Array<{ type: LookupType; label: string; labelSingular: string }> = [
  { type: 'asset-conditions', label: 'Asset conditions', labelSingular: 'Asset condition' },
  { type: 'asset-types', label: 'Asset types', labelSingular: 'Asset type' },
  { type: 'transaction-reasons', label: 'Transaction reasons', labelSingular: 'Transaction reason' },
  { type: 'adjustment-reasons', label: 'Adjustment reasons', labelSingular: 'Adjustment reason' },
  { type: 'disposal-methods', label: 'Disposal methods', labelSingular: 'Disposal method' },
  { type: 'maintenance-types', label: 'Maintenance types', labelSingular: 'Maintenance type' },
  { type: 'maintenance-priorities', label: 'Maintenance priorities', labelSingular: 'Maintenance priority' },
  { type: 'work-order-statuses', label: 'Work order statuses', labelSingular: 'Work order status' },
  { type: 'supplier-categories', label: 'Supplier categories', labelSingular: 'Supplier category' },
  { type: 'document-types', label: 'Document types', labelSingular: 'Document type' },
  { type: 'notification-types', label: 'Notification types', labelSingular: 'Notification type' },
];

function DepartmentsTab({ canManage }: { canManage: boolean }) {
  return (
    <LookupSection<Department, Parameters<typeof createDepartment>[0], string | null>
      label="Department"
      labelPlural="Departments"
      description="Cost-center tags for employees and issuances. The head approves department-level requests."
      queryKey={['departments']}
      fetchRows={(signal) => listDepartments({ page: 1, pageSize: 100 }, signal)}
      create={createDepartment}
      update={(id, body) => updateDepartment(id, body)}
      canManage={canManage}
      extraColumns={[
        {
          header: 'Head',
          className: 'hidden lg:table-cell text-sm text-muted-foreground',
          cell: (row) => (row.headEmployee ? employeeName(row.headEmployee) : '—'),
        },
      ]}
      dialogExtra={{
        getInitial: (target) => target?.headEmployeeId ?? null,
        toBody: (value) => ({ headEmployeeId: value }),
        render: (value, setValue, target) => (
          <FormField
            label="Department head"
            htmlFor="dept-head"
            hint="Approver for department-level approval steps."
          >
            <EmployeePicker
              id="dept-head"
              value={value}
              onChange={setValue}
              selectedLabel={target?.headEmployee ? employeeName(target.headEmployee) : undefined}
              placeholder="Search employees…"
            />
          </FormField>
        ),
      }}
    />
  );
}

function OtherListsTab({ canManage }: { canManage: boolean }) {
  const [type, setType] = React.useState<LookupType>('asset-conditions');
  const config = OTHER_LOOKUP_TYPES.find((entry) => entry.type === type)!;

  return (
    <div className="space-y-3">
      <div className="max-w-xs">
        <FormField label="Lookup list" htmlFor="other-lookup-type">
          <Select
            id="other-lookup-type"
            value={type}
            onChange={(event) => setType(event.target.value as LookupType)}
          >
            {OTHER_LOOKUP_TYPES.map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <LookupSection
        key={type}
        label={config.labelSingular}
        labelPlural={config.label}
        description="Business-managed values — deletion is refused once referenced; deactivate instead."
        queryKey={['lookups', type]}
        fetchRows={(signal) => listLookupValues(type, { page: 1, pageSize: 100 }, signal)}
        create={(body) => createLookupValue(type, body)}
        update={(id, body) => updateLookupValue(type, id, body)}
        canManage={canManage}
        withDescription
        withSortOrder
      />
    </div>
  );
}

export function LookupsPage() {
  const { can } = useSession();
  const canManage = can(PERMISSIONS.lookup.manage);
  const [tab, setTab] = React.useState('departments');

  return (
    <>
      <PageHeader
        title="Lookups"
        description="Business-managed configuration lists used across GEM ERP."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Lookup categories">
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="categories">Item categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="manufacturers">Manufacturers</TabsTrigger>
          <TabsTrigger value="uoms">UOMs</TabsTrigger>
          <TabsTrigger value="conversions">UOM conversions</TabsTrigger>
          <TabsTrigger value="other">Other lists</TabsTrigger>
        </TabsList>

        <TabsContent value="departments">
          <DepartmentsTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="positions">
          <LookupSection
            label="Position"
            labelPlural="Positions"
            description="Job titles for employee records."
            queryKey={['positions']}
            fetchRows={(signal) => listPositions({ page: 1, pageSize: 100 }, signal)}
            create={createPosition}
            update={(id, body) => updatePosition(id, body)}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="categories">
          <CategoriesTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="brands">
          <LookupSection
            label="Brand"
            labelPlural="Brands"
            description="Product brands referenced by catalog items."
            queryKey={['brands']}
            fetchRows={(signal) => listBrands({ page: 1, pageSize: 100 }, signal)}
            create={createBrand}
            update={(id, body) => updateBrand(id, body)}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="manufacturers">
          <LookupSection
            label="Manufacturer"
            labelPlural="Manufacturers"
            description="Manufacturers referenced by catalog items."
            queryKey={['manufacturers']}
            fetchRows={(signal) => listManufacturers({ page: 1, pageSize: 100 }, signal)}
            create={createManufacturer}
            update={(id, body) => updateManufacturer(id, body)}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="uoms">
          <LookupSection
            label="Unit of measure"
            labelPlural="Units of measure"
            description="Base, purchase, and issue units for the item catalog."
            queryKey={['uoms']}
            fetchRows={(signal) => listUoms({ page: 1, pageSize: 100 }, signal)}
            create={createUom}
            update={(id, body) => updateUom(id, body)}
            canManage={canManage}
            withDescription
          />
        </TabsContent>

        <TabsContent value="conversions">
          <ConversionsTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="other">
          <OtherListsTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </>
  );
}
