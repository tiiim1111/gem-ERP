'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CornerDownRight, MapPin, Pencil, Plus, Power, PowerOff, Warehouse as WarehouseIcon } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import {
  activateBranch,
  deactivateBranch,
  getBranch,
  listStorageLocations,
  listWarehouses,
} from '@/lib/endpoints';
import { storageLocationKind, type Branch, type StorageLocation, type Warehouse } from '@/lib/types';
import { cn, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { BranchFormDialog } from './branch-form-dialog';
import { LocationDialog } from './location-dialog';
import { WarehouseDialog } from './warehouse-dialog';

/* ------------------------- Storage location tree ------------------------- */

interface LocationNode {
  location: StorageLocation;
  children: LocationNode[];
}

function buildLocationTree(locations: StorageLocation[]): LocationNode[] {
  const byId = new Map<string, LocationNode>();
  for (const location of locations) {
    byId.set(location.id, { location, children: [] });
  }
  const roots: LocationNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.location.parentId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: LocationNode[]) => {
    nodes.sort((a, b) => a.location.code.localeCompare(b.location.code));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

function LocationRows({
  nodes,
  depth,
  canEdit,
  onEdit,
}: {
  nodes: LocationNode[];
  depth: number;
  canEdit: boolean;
  onEdit: (location: StorageLocation) => void;
}) {
  return (
    <>
      {nodes.map(({ location, children }) => {
        const kind = storageLocationKind(location);
        return (
          <React.Fragment key={location.id}>
            <TableRow>
              <TableCell>
                <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                  {depth > 0 ? (
                    <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : null}
                  <span className="font-mono text-xs">{location.code}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm">{location.name}</TableCell>
              <TableCell className="hidden sm:table-cell">
                {kind ? <Badge variant="outline">{humanize(kind)}</Badge> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                {location.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="muted">Inactive</Badge>
                )}
              </TableCell>
              {canEdit ? (
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Edit location ${location.code}`}
                    onClick={() => onEdit(location)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
            <LocationRows nodes={children} depth={depth + 1} canEdit={canEdit} onEdit={onEdit} />
          </React.Fragment>
        );
      })}
    </>
  );
}

function StorageLocationsCard({ warehouse }: { warehouse: Warehouse }) {
  const { can } = useSession();
  const canEdit = can(PERMISSIONS.storageLocation.update) || can(PERMISSIONS.warehouse.update);
  const canCreate = can(PERMISSIONS.storageLocation.create) || can(PERMISSIONS.warehouse.update);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<StorageLocation | null>(null);

  const locationsQuery = useQuery({
    queryKey: ['storage-locations', warehouse.id],
    queryFn: ({ signal }) => listStorageLocations(warehouse.id, { page: 1, pageSize: 100 }, signal),
  });

  const locations = locationsQuery.data?.data ?? [];
  const tree = React.useMemo(() => buildLocationTree(locations), [locations]);
  const total = locationsQuery.data?.meta.total ?? 0;

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1">
          <CardTitle>
            Storage locations · <span className="font-mono text-sm">{warehouse.code}</span>
          </CardTitle>
          <CardDescription>Zones, racks, shelves, and bins inside {warehouse.name}.</CardDescription>
        </div>
        {canCreate ? (
          <Button size="sm" className="mt-2 sm:mt-0" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden /> New location
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {locationsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : locationsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={locationsQuery.error} onRetry={() => locationsQuery.refetch()} />
          </div>
        ) : locations.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No storage locations"
            description="Create the first location for this warehouse."
            action={
              canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden /> New location
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead>Status</TableHead>
                  {canEdit ? <TableHead className="w-12 text-right">Edit</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                <LocationRows nodes={tree} depth={0} canEdit={canEdit} onEdit={setEditTarget} />
              </TableBody>
            </Table>
            {total > locations.length ? (
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                Showing the first {locations.length} of {total} locations.
              </p>
            ) : null}
          </>
        )}
      </CardContent>

      <LocationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        warehouseId={warehouse.id}
        locations={locations}
      />
      <LocationDialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        warehouseId={warehouse.id}
        locations={locations}
        location={editTarget}
      />
    </Card>
  );
}

/* ------------------------------- Warehouses ------------------------------ */

function WarehousesCard({
  branch,
  selectedWarehouseId,
  onSelectWarehouse,
}: {
  branch: Branch;
  selectedWarehouseId: string | null;
  onSelectWarehouse: (id: string) => void;
}) {
  const { can } = useSession();
  const canCreate = can(PERMISSIONS.warehouse.create);
  const canUpdate = can(PERMISSIONS.warehouse.update);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<Warehouse | null>(null);

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', branch.id],
    queryFn: ({ signal }) => listWarehouses(branch.id, { page: 1, pageSize: 100 }, signal),
  });

  const warehouses = warehousesQuery.data?.data ?? [];

  // Auto-select the first warehouse once loaded.
  React.useEffect(() => {
    if (!selectedWarehouseId && warehouses.length > 0) {
      onSelectWarehouse(warehouses[0]!.id);
    }
  }, [warehouses, selectedWarehouseId, onSelectWarehouse]);

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1">
          <CardTitle>Warehouses</CardTitle>
          <CardDescription>Select a warehouse to manage its storage locations.</CardDescription>
        </div>
        {canCreate ? (
          <Button size="sm" className="mt-2 sm:mt-0" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden /> New warehouse
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {warehousesQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : warehousesQuery.isError ? (
          <div className="p-4">
            <ErrorState error={warehousesQuery.error} onRetry={() => warehousesQuery.refetch()} />
          </div>
        ) : warehouses.length === 0 ? (
          <EmptyState
            icon={WarehouseIcon}
            title="No warehouses yet"
            description="Create a warehouse to start organizing storage."
            action={
              canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden /> New warehouse
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y">
            {warehouses.map((warehouse) => {
              const selected = warehouse.id === selectedWarehouseId;
              return (
                <li key={warehouse.id}>
                  <div
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-4 py-2.5 transition-colors sm:px-5',
                      selected ? 'bg-primary/5' : 'hover:bg-muted/50',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectWarehouse(warehouse.id)}
                      aria-pressed={selected}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <WarehouseIcon
                        className={cn('h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className={cn('block truncate text-sm font-medium', selected && 'text-primary')}>
                          {warehouse.name}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">{warehouse.code}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {warehouse.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="muted">Inactive</Badge>
                      )}
                      {canUpdate ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Edit warehouse ${warehouse.code}`}
                          onClick={() => setEditTarget(warehouse)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <WarehouseDialog open={createOpen} onOpenChange={setCreateOpen} branchId={branch.id} />
      <WarehouseDialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        branchId={branch.id}
        warehouse={editTarget}
      />
    </Card>
  );
}

/* ------------------------------ Branch detail ---------------------------- */

export function BranchDetail({ branchId }: { branchId: string }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = React.useState(false);
  const [toggleOpen, setToggleOpen] = React.useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = React.useState<string | null>(null);

  const branchQuery = useQuery({
    queryKey: ['branches', 'detail', branchId],
    queryFn: ({ signal }) => getBranch(branchId, signal),
  });

  const branch = branchQuery.data;

  const toggleMutation = useMutation({
    mutationFn: () => (branch!.isActive ? deactivateBranch(branch!.id) : activateBranch(branch!.id)),
    onSuccess: () => {
      toast({
        title: branch?.isActive ? 'Branch deactivated' : 'Branch activated',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
  });

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', branchId],
    queryFn: ({ signal }) => listWarehouses(branchId, { page: 1, pageSize: 100 }, signal),
    enabled: !!branch,
  });
  const selectedWarehouse =
    warehousesQuery.data?.data.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null;

  const canUpdate = can(PERMISSIONS.branch.update);
  const canActivate = can(PERMISSIONS.branch.activate);
  const canDeactivate = can(PERMISSIONS.branch.deactivate);

  return (
    <>
      <div className="mb-3">
        <Link
          href="/branches"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to branches
        </Link>
      </div>

      {branchQuery.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : branchQuery.isError ? (
        <ErrorState error={branchQuery.error} onRetry={() => branchQuery.refetch()} />
      ) : branch ? (
        <>
          <PageHeader
            title={branch.name}
            description={[branch.code, branch.address].filter(Boolean).join(' · ')}
            actions={
              <div className="flex items-center gap-2">
                {branch.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="muted">Inactive</Badge>
                )}
                {canUpdate ? (
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                ) : null}
                {(branch.isActive && canDeactivate) || (!branch.isActive && canActivate) ? (
                  <Button
                    variant={branch.isActive ? 'destructive' : 'default'}
                    size="sm"
                    onClick={() => setToggleOpen(true)}
                  >
                    {branch.isActive ? (
                      <>
                        <PowerOff aria-hidden /> Deactivate
                      </>
                    ) : (
                      <>
                        <Power aria-hidden /> Activate
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            }
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="xl:col-span-2">
              <WarehousesCard
                branch={branch}
                selectedWarehouseId={selectedWarehouseId}
                onSelectWarehouse={setSelectedWarehouseId}
              />
            </div>
            <div className="xl:col-span-3">
              {selectedWarehouse ? (
                <StorageLocationsCard warehouse={selectedWarehouse} />
              ) : (
                <Card>
                  <CardContent className="p-0 sm:p-0">
                    <EmptyState
                      icon={MapPin}
                      title="No warehouse selected"
                      description="Select a warehouse on the left to manage its storage locations."
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          <BranchFormDialog open={editOpen} onOpenChange={setEditOpen} branch={branch} />
          <ConfirmDialog
            open={toggleOpen}
            onOpenChange={setToggleOpen}
            title={branch.isActive ? 'Deactivate branch' : 'Activate branch'}
            destructive={branch.isActive}
            confirmLabel={branch.isActive ? 'Deactivate' : 'Activate'}
            description={
              branch.isActive ? (
                <>
                  <span className="font-medium text-foreground">{branch.name}</span> will be unavailable for
                  new activity. Existing records and history are preserved.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{branch.name}</span> will be available again
                  for new activity.
                </>
              )
            }
            onConfirm={() => toggleMutation.mutateAsync()}
          />
        </>
      ) : null}
    </>
  );
}
