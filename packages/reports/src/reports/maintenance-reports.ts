/**
 * Maintenance summary report (api-outline §8): due, overdue, cost, and
 * downtime per work order. Requires maintenance.work_order.view; cost
 * columns require maintenance.work_order.view_cost.
 */
import { MaintenanceWorkOrderStatus, Prisma } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import {
  branchWhere,
  dateRange,
  decimalString,
  isoDateTime,
} from '../filters';
import type { ReportContext, ReportDefinition, ReportPrisma } from '../types';

const OPEN_WO_STATUSES = [
  MaintenanceWorkOrderStatus.OPEN,
  MaintenanceWorkOrderStatus.ASSIGNED,
  MaintenanceWorkOrderStatus.SCHEDULED,
  MaintenanceWorkOrderStatus.IN_PROGRESS,
  MaintenanceWorkOrderStatus.ON_HOLD,
  MaintenanceWorkOrderStatus.AWAITING_PARTS,
  MaintenanceWorkOrderStatus.AWAITING_VENDOR,
] as const;

export const maintenanceSummary: ReportDefinition = {
  key: 'maintenance-summary',
  title: 'Maintenance summary',
  description:
    'Work orders with schedule adherence (due/overdue), downtime, and cost breakdown.',
  permission: PERMISSIONS.maintenanceWorkOrder.view,
  costPermission: PERMISSIONS.maintenanceWorkOrder.viewCost,
  filters: ['branchId', 'itemId', 'employeeId', 'status', 'from', 'to'],
  statusOptions: Object.values(MaintenanceWorkOrderStatus),
  columns: [
    { key: 'workOrderNumber', header: 'WO no.', width: 1.1 },
    { key: 'assetTag', header: 'Asset tag', width: 1.3 },
    { key: 'itemName', header: 'Item', width: 1.4 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'type', header: 'Type' },
    { key: 'priority', header: 'Priority' },
    { key: 'status', header: 'Status', width: 1.1 },
    { key: 'overdue', header: 'Overdue', width: 0.7 },
    { key: 'assignedTo', header: 'Assigned to', width: 1.2 },
    { key: 'scheduledStartAt', header: 'Scheduled start', width: 1.2 },
    { key: 'scheduledEndAt', header: 'Scheduled end', width: 1.2 },
    { key: 'actualStartAt', header: 'Actual start', width: 1.2 },
    { key: 'actualEndAt', header: 'Actual end', width: 1.2 },
    { key: 'downtimeMinutes', header: 'Downtime (min)', width: 0.9 },
    { key: 'laborCost', header: 'Labor cost', cost: true, width: 0.8 },
    { key: 'partsCost', header: 'Parts cost', cost: true, width: 0.8 },
    { key: 'externalCost', header: 'External cost', cost: true, width: 0.8 },
    { key: 'totalCost', header: 'Total cost', cost: true, width: 0.8 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const created = dateRange(f);
    const where: Prisma.MaintenanceWorkOrderWhereInput = {
      branchId: branchWhere(ctx),
      ...(f.status ? { status: f.status as MaintenanceWorkOrderStatus } : {}),
      ...(f.itemId ? { asset: { itemId: f.itemId } } : {}),
      ...(f.employeeId ? { assignedToEmployeeId: f.employeeId } : {}),
      ...(created ? { createdAt: created } : {}),
    };
    const now = new Date();
    const [rows, total] = await Promise.all([
      prisma.maintenanceWorkOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          workOrderNumber: true,
          status: true,
          scheduledStartAt: true,
          scheduledEndAt: true,
          actualStartAt: true,
          actualEndAt: true,
          downtimeMinutes: true,
          laborCost: true,
          partsCost: true,
          externalCost: true,
          totalCost: true,
          branch: { select: { code: true } },
          asset: {
            select: { assetTag: true, item: { select: { name: true } } },
          },
          type: { select: { name: true } },
          priority: { select: { name: true } },
          assignedToEmployee: {
            select: { firstName: true, lastName: true, displayName: true },
          },
          assignedVendor: { select: { legalName: true } },
          assignedTeam: true,
        },
      }),
      prisma.maintenanceWorkOrder.count({ where }),
    ]);
    return {
      rows: rows.map((wo) => {
        const isOpen = (OPEN_WO_STATUSES as readonly string[]).includes(wo.status);
        const overdue =
          isOpen && wo.scheduledEndAt !== null && wo.scheduledEndAt < now;
        const assignee = wo.assignedToEmployee
          ? (wo.assignedToEmployee.displayName ??
            `${wo.assignedToEmployee.firstName} ${wo.assignedToEmployee.lastName}`)
          : (wo.assignedVendor?.legalName ?? wo.assignedTeam);
        return {
          workOrderNumber: wo.workOrderNumber,
          assetTag: wo.asset.assetTag,
          itemName: wo.asset.item.name,
          branch: wo.branch.code,
          type: wo.type.name,
          priority: wo.priority?.name ?? null,
          status: wo.status,
          overdue,
          assignedTo: assignee ?? null,
          scheduledStartAt: isoDateTime(wo.scheduledStartAt),
          scheduledEndAt: isoDateTime(wo.scheduledEndAt),
          actualStartAt: isoDateTime(wo.actualStartAt),
          actualEndAt: isoDateTime(wo.actualEndAt),
          downtimeMinutes: wo.downtimeMinutes,
          ...(ctx.includeCost
            ? {
                laborCost: decimalString(wo.laborCost),
                partsCost: decimalString(wo.partsCost),
                externalCost: decimalString(wo.externalCost),
                totalCost: decimalString(wo.totalCost),
              }
            : {}),
        };
      }),
      total,
    };
  },
};
