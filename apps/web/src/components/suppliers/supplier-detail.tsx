'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, CircleAlert, Pencil, Plus, Power, Trash2, Users } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage } from '@/lib/api';
import {
  activateSupplier,
  archiveSupplier,
  deactivateSupplier,
  deleteSupplierContact,
  getSupplier,
  getSupplierHistory,
  listPurchaseOrders,
  listSupplierContacts,
  unwrapList,
} from '@/lib/endpoints';
import {
  formatMoney,
  poExpectedDate,
  poGrandTotal,
  purchaseOrderNumber,
  refLabel,
  supplierCategories,
  supplierHistoryLastDelivery,
  supplierHistoryOpenPoCount,
  supplierHistoryPoCount,
  supplierHistoryReceiptCount,
  supplierHistorySpend,
  supplierLegalName,
  supplierName,
  type Supplier,
  type SupplierContact,
} from '@/lib/types';
import { PROCUREMENT_COST_PERMISSIONS } from '@/lib/status-maps';
import { formatDate } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { poStatusBadge } from '@/components/procurement/badges';
import { SupplierContactDialog } from './supplier-contact-dialog';
import { SupplierFormDialog } from './supplier-form-dialog';

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value ?? '—'}</dd>
    </div>
  );
}

function ContactsCard({ supplier, canUpdate }: { supplier: Supplier; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [contactDialogOpen, setContactDialogOpen] = React.useState(false);
  const [editContact, setEditContact] = React.useState<SupplierContact | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<SupplierContact | null>(null);

  const contactsQuery = useQuery({
    queryKey: ['suppliers', 'contacts', supplier.id],
    queryFn: ({ signal }) => listSupplierContacts(supplier.id, signal),
  });
  const contacts = contactsQuery.data ? unwrapList(contactsQuery.data) : [];

  const removeMutation = useMutation({
    mutationFn: (contactId: string) => deleteSupplierContact(supplier.id, contactId),
    onSuccess: () => {
      toast({ title: 'Contact removed', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Contact people</CardTitle>
          <CardDescription>Order, delivery, and billing contacts at this supplier.</CardDescription>
        </div>
        {canUpdate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditContact(null);
              setContactDialogOpen(true);
            }}
          >
            <Plus aria-hidden /> Add contact
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {contactsQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : contactsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={contactsQuery.error} onRetry={() => contactsQuery.refetch()} />
          </div>
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No contacts yet"
            description="Add the people you coordinate orders and deliveries with."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Position</TableHead>
                <TableHead className="hidden md:table-cell">Email / phone</TableHead>
                {canUpdate ? <TableHead className="w-32 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {contact.name}
                      {contact.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {contact.position ?? '—'}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    <span className="block">{contact.email ?? '—'}</span>
                    <span className="block text-xs">{contact.phone ?? ''}</span>
                  </TableCell>
                  {canUpdate ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditContact(contact);
                            setContactDialogOpen(true);
                          }}
                          aria-label={`Edit ${contact.name}`}
                        >
                          <Pencil aria-hidden /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setRemoveTarget(contact)}
                          aria-label={`Remove ${contact.name}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <SupplierContactDialog
        open={contactDialogOpen}
        onOpenChange={setContactDialogOpen}
        supplierId={supplier.id}
        contact={editContact}
      />
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove contact"
        description={
          <>
            Removes{' '}
            <span className="font-medium text-foreground">{removeTarget?.name ?? 'this contact'}</span>{' '}
            from the supplier record.
          </>
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (removeTarget) await removeMutation.mutateAsync(removeTarget.id);
        }}
      />
    </Card>
  );
}

function PurchaseSummaryCard({ supplierId }: { supplierId: string }) {
  const { canAny } = useSession();
  const canViewCost = canAny(PROCUREMENT_COST_PERMISSIONS);

  const historyQuery = useQuery({
    queryKey: ['suppliers', 'history', supplierId],
    queryFn: ({ signal }) => getSupplierHistory(supplierId, signal),
    retry: false,
  });

  const recentPosQuery = useQuery({
    queryKey: ['purchase-orders', 'supplier-recent', supplierId],
    queryFn: ({ signal }) =>
      listPurchaseOrders(
        { page: 1, pageSize: 5, supplierId, sort: 'createdAt:desc' },
        signal,
      ),
  });

  const rollup = historyQuery.data;
  const rollupRows = rollup
    ? ([
        ['Purchase orders', supplierHistoryPoCount(rollup)],
        ['Open purchase orders', supplierHistoryOpenPoCount(rollup)],
        ['Goods receipts', supplierHistoryReceiptCount(rollup)],
        ['Last order', rollup.lastOrderDate ? formatDate(rollup.lastOrderDate) : null],
        ['Last delivery', formatDate(supplierHistoryLastDelivery(rollup) ?? undefined)],
        ...(canViewCost && supplierHistorySpend(rollup) !== null
          ? ([['Total purchased', formatMoney(supplierHistorySpend(rollup))]] as const)
          : []),
      ] as Array<[string, React.ReactNode]>)
    : [];
  const visibleRollupRows = rollupRows.filter(
    ([, value]) => value !== null && value !== undefined && value !== '—',
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Purchase summary</CardTitle>
          <CardDescription>Recent purchase orders with this supplier.</CardDescription>
        </div>
        <Link
          href="/procurement/purchase-orders"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          All POs
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleRollupRows.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {visibleRollupRows.map(([label, value]) => (
              <div key={label} className="py-1.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {recentPosQuery.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : recentPosQuery.isError ? (
          <ErrorState error={recentPosQuery.error} onRetry={() => recentPosQuery.refetch()} />
        ) : (recentPosQuery.data?.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchase orders with this supplier yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Branch</TableHead>
                <TableHead className="hidden md:table-cell">Expected</TableHead>
                {canViewCost ? <TableHead className="text-right">Total</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recentPosQuery.data?.data ?? []).map((po) => (
                <TableRow key={po.id}>
                  <TableCell>
                    <Link
                      href={`/procurement/purchase-orders/${po.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {purchaseOrderNumber(po)}
                    </Link>
                  </TableCell>
                  <TableCell>{poStatusBadge(po.status)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {po.branch ? refLabel(po.branch) : '—'}
                  </TableCell>
                  <TableCell className="hidden text-sm tabular-nums text-muted-foreground md:table-cell">
                    {formatDate(poExpectedDate(po))}
                  </TableCell>
                  {canViewCost ? (
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatMoney(poGrandTotal(po))}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function SupplierDetail({ supplierId }: { supplierId: string }) {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { toast } = useToast();

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<'activate' | 'deactivate' | 'archive' | null>(
    null,
  );

  const supplierQuery = useQuery({
    queryKey: ['suppliers', 'detail', supplierId],
    queryFn: ({ signal }) => getSupplier(supplierId, signal),
  });
  const supplier = supplierQuery.data;

  const canUpdate = can(PERMISSIONS.supplier.update);
  const canArchive = can(PERMISSIONS.supplier.archive);
  const canViewPos = can(PERMISSIONS.procurementPo.view);

  const statusMutation = useMutation({
    mutationFn: async (action: 'activate' | 'deactivate' | 'archive') => {
      if (action === 'activate') return activateSupplier(supplierId);
      if (action === 'deactivate') return deactivateSupplier(supplierId);
      return archiveSupplier(supplierId);
    },
    onSuccess: (_saved, action) => {
      setActionError(null);
      const labels = { activate: 'activated', deactivate: 'deactivated', archive: 'archived' } as const;
      toast({ title: `Supplier ${labels[action]}`, variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error) => setActionError(getErrorMessage(error)),
  });

  if (supplierQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (supplierQuery.isError || !supplier) {
    return <ErrorState error={supplierQuery.error} onRetry={() => supplierQuery.refetch()} />;
  }

  const categories = supplierCategories(supplier);

  return (
    <>
      <PageHeader
        title={supplierName(supplier)}
        description={`Supplier ${supplier.code}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/suppliers" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All suppliers
            </Link>
            {canUpdate ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
            ) : null}
            {canUpdate && !supplier.archivedAt ? (
              supplier.isActive ? (
                <Button variant="outline" onClick={() => setConfirmAction('deactivate')}>
                  <Power aria-hidden /> Deactivate
                </Button>
              ) : (
                <Button onClick={() => setConfirmAction('activate')}>
                  <Power aria-hidden /> Activate
                </Button>
              )
            ) : null}
            {canArchive && !supplier.archivedAt ? (
              <Button variant="outline" onClick={() => setConfirmAction('archive')}>
                <Archive aria-hidden /> Archive
              </Button>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{actionError}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Details</CardTitle>
            {supplier.archivedAt ? (
              <Badge variant="muted">Archived</Badge>
            ) : supplier.isActive ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="muted">Inactive</Badge>
            )}
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="Code" value={<span className="font-mono text-xs">{supplier.code}</span>} />
              <DetailRow label="Legal name" value={supplierLegalName(supplier)} />
              {supplier.tradeName ? <DetailRow label="Trade name" value={supplier.tradeName} /> : null}
              <DetailRow
                label="Categories"
                value={
                  categories.length === 0 ? (
                    '—'
                  ) : (
                    <span className="flex flex-wrap justify-end gap-1">
                      {categories.map((category) => (
                        <Badge key={category.id} variant="secondary">
                          {category.name}
                        </Badge>
                      ))}
                    </span>
                  )
                }
              />
              <DetailRow label="Email" value={supplier.email} />
              <DetailRow label="Phone" value={supplier.phone} />
              <DetailRow
                label="Address"
                value={[supplier.address, supplier.city].filter(Boolean).join(', ') || '—'}
              />
              <DetailRow label="Tax / registration ID" value={supplier.taxId} />
              <DetailRow label="Payment terms" value={supplier.paymentTerms} />
            </dl>
            {supplier.notes ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{supplier.notes}</p>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4 xl:col-span-2">
          <ContactsCard supplier={supplier} canUpdate={canUpdate} />
          {canViewPos ? <PurchaseSummaryCard supplierId={supplier.id} /> : null}
        </div>
      </div>

      <SupplierFormDialog open={editOpen} onOpenChange={setEditOpen} supplier={supplier} />

      <ConfirmDialog
        open={confirmAction === 'deactivate'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Deactivate supplier"
        description="Inactive suppliers cannot be picked on new purchase orders. Existing documents and history are preserved."
        confirmLabel="Deactivate"
        onConfirm={() => statusMutation.mutateAsync('deactivate')}
      />
      <ConfirmDialog
        open={confirmAction === 'activate'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Activate supplier"
        description="The supplier becomes selectable on new purchase orders again."
        confirmLabel="Activate"
        onConfirm={() => statusMutation.mutateAsync('activate')}
      />
      <ConfirmDialog
        open={confirmAction === 'archive'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Archive supplier"
        description="Soft-archives this supplier. History stays intact; the record disappears from active pick lists."
        confirmLabel="Archive"
        destructive
        onConfirm={() => statusMutation.mutateAsync('archive')}
      />
    </>
  );
}
