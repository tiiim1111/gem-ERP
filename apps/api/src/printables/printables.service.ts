import { Injectable } from '@nestjs/common';
import { InventoryCountStatus } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { DocTable, renderPrintableDocument } from './printable-pdf';

export interface PrintableFile {
  fileName: string;
  buffer: Buffer;
}

function money(value: { toString(): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function dateTime(value: Date | null | undefined): string | null {
  return value ? value.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null;
}

function person(
  employee:
    | { firstName: string; lastName: string; displayName: string | null }
    | null
    | undefined,
): string | null {
  if (!employee) {
    return null;
  }
  return employee.displayName ?? `${employee.firstName} ${employee.lastName}`;
}

/**
 * Phase 7 printable documents (api-outline §8): PDF renders of the six key
 * forms. Each render is gated by the PARENT resource's view permission
 * (enforced at the controller), branch-scoped here (out-of-scope → 404, no
 * existence leak), audit-logged, and cost figures appear only with the
 * parent's *.view_cost permission.
 */
@Injectable()
export class PrintablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Purchase order
  // -------------------------------------------------------------------------

  async purchaseOrderPdf(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<PrintableFile> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        poNumber: true,
        status: true,
        branchId: true,
        orderDate: true,
        expectedDeliveryDate: true,
        currencyCode: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        grandTotal: true,
        terms: true,
        notes: true,
        supplier: { select: { legalName: true, address: true, email: true } },
        branch: { select: { code: true, name: true } },
        destinationWarehouse: { select: { code: true, name: true } },
        createdBy: { select: { displayName: true } },
        approvedBy: { select: { displayName: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: {
            lineNumber: true,
            quantity: true,
            unitPrice: true,
            discountAmount: true,
            taxAmount: true,
            lineTotal: true,
            receivedQuantity: true,
            item: { select: { sku: true, name: true } },
            uom: { select: { code: true } },
          },
        },
      },
    });
    if (!po || !this.branchScope.canAccess(user, po.branchId)) {
      throw AppException.notFound('Purchase order not found.');
    }
    const includeCost =
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.procurementPo.viewCost);

    const table: DocTable = {
      caption: 'Order lines',
      columns: [
        { header: '#', width: 0.4 },
        { header: 'SKU', width: 1.2 },
        { header: 'Item', width: 2.4 },
        { header: 'UOM', width: 0.6 },
        { header: 'Qty', width: 0.8, align: 'right' },
        { header: 'Received', width: 0.8, align: 'right' },
        ...(includeCost
          ? [
              { header: 'Unit price', width: 0.9, align: 'right' as const },
              { header: 'Line total', width: 1, align: 'right' as const },
            ]
          : []),
      ],
      rows: po.lines.map((line) => [
        String(line.lineNumber),
        line.item.sku,
        line.item.name,
        line.uom.code,
        line.quantity.toString(),
        line.receivedQuantity.toString(),
        ...(includeCost
          ? [money(line.unitPrice), money(line.lineTotal)]
          : []),
      ]),
      ...(includeCost
        ? {
            totals: [
              ['Subtotal', `${po.currencyCode} ${po.subtotal.toString()}`],
              ['Discount', `${po.currencyCode} ${po.discountTotal.toString()}`],
              ['Tax', `${po.currencyCode} ${po.taxTotal.toString()}`],
              ['Grand total', `${po.currencyCode} ${po.grandTotal.toString()}`],
            ] as Array<[string, string]>,
          }
        : {}),
    };

    const buffer = await renderPrintableDocument({
      title: 'PURCHASE ORDER',
      documentNumber: po.poNumber,
      subtitle: `Status: ${po.status}`,
      fieldGroups: [
        [
          { label: 'Supplier', value: po.supplier.legalName },
          { label: 'Supplier address', value: po.supplier.address },
          { label: 'Ordering branch', value: `${po.branch.code} — ${po.branch.name}` },
          {
            label: 'Deliver to',
            value: `${po.destinationWarehouse.code} — ${po.destinationWarehouse.name}`,
          },
          { label: 'Order date', value: dateOnly(po.orderDate) },
          { label: 'Expected delivery', value: dateOnly(po.expectedDeliveryDate) },
          { label: 'Currency', value: po.currencyCode },
          { label: 'Terms', value: po.terms },
        ],
      ],
      tables: [table],
      notes: po.notes,
      signatures: [
        { role: 'Prepared by', name: po.createdBy.displayName },
        { role: 'Approved by', name: po.approvedBy?.displayName ?? null },
        { role: 'Supplier acknowledgment', name: null },
      ],
    });

    await this.auditRender(ctx, 'purchase_order.printed', po.id, po.branchId, {
      number: po.poNumber,
    });
    return { fileName: `${po.poNumber}.pdf`, buffer };
  }

  // -------------------------------------------------------------------------
  // Goods receipt
  // -------------------------------------------------------------------------

  async goodsReceiptPdf(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<PrintableFile> {
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      select: {
        id: true,
        receiptNumber: true,
        status: true,
        branchId: true,
        receiptDate: true,
        supplierReference: true,
        notes: true,
        purchaseOrder: {
          select: { poNumber: true, supplier: { select: { legalName: true } } },
        },
        branch: { select: { code: true, name: true } },
        warehouse: { select: { code: true, name: true } },
        createdBy: { select: { displayName: true } },
        postedBy: { select: { displayName: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: {
            lineNumber: true,
            receivedQuantity: true,
            unitCost: true,
            serialNumbers: true,
            item: { select: { sku: true, name: true } },
            uom: { select: { code: true } },
            lot: { select: { lotNumber: true } },
            storageLocation: { select: { code: true } },
          },
        },
      },
    });
    if (!receipt || !this.branchScope.canAccess(user, receipt.branchId)) {
      throw AppException.notFound('Goods receipt not found.');
    }
    const includeCost =
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.procurementPo.viewCost);

    const buffer = await renderPrintableDocument({
      title: 'RECEIVING REPORT',
      documentNumber: receipt.receiptNumber,
      subtitle: `Status: ${receipt.status}`,
      fieldGroups: [
        [
          { label: 'Purchase order', value: receipt.purchaseOrder.poNumber },
          { label: 'Supplier', value: receipt.purchaseOrder.supplier.legalName },
          {
            label: 'Receiving branch',
            value: `${receipt.branch.code} — ${receipt.branch.name}`,
          },
          {
            label: 'Warehouse',
            value: `${receipt.warehouse.code} — ${receipt.warehouse.name}`,
          },
          { label: 'Receipt date', value: dateOnly(receipt.receiptDate) },
          { label: 'Supplier reference', value: receipt.supplierReference },
          { label: 'Recorded by', value: receipt.createdBy.displayName },
          { label: 'Posted by', value: receipt.postedBy?.displayName ?? null },
        ],
      ],
      tables: [
        {
          caption: 'Received lines',
          columns: [
            { header: '#', width: 0.4 },
            { header: 'SKU', width: 1.2 },
            { header: 'Item', width: 2.2 },
            { header: 'UOM', width: 0.6 },
            { header: 'Qty', width: 0.7, align: 'right' },
            { header: 'Lot', width: 1 },
            { header: 'Location', width: 0.9 },
            { header: 'Serials', width: 0.7, align: 'right' },
            ...(includeCost
              ? [{ header: 'Unit cost', width: 0.9, align: 'right' as const }]
              : []),
          ],
          rows: receipt.lines.map((line) => [
            String(line.lineNumber),
            line.item.sku,
            line.item.name,
            line.uom.code,
            line.receivedQuantity.toString(),
            line.lot?.lotNumber ?? null,
            line.storageLocation?.code ?? null,
            line.serialNumbers.length > 0 ? String(line.serialNumbers.length) : null,
            ...(includeCost ? [money(line.unitCost)] : []),
          ]),
        },
      ],
      notes: receipt.notes,
      signatures: [
        {
          role: 'Received by',
          name: receipt.postedBy?.displayName ?? receipt.createdBy.displayName,
        },
        { role: 'Checked by', name: null },
      ],
    });

    await this.auditRender(ctx, 'goods_receipt.printed', receipt.id, receipt.branchId, {
      number: receipt.receiptNumber,
    });
    return { fileName: `${receipt.receiptNumber}.pdf`, buffer };
  }

  // -------------------------------------------------------------------------
  // Transfer
  // -------------------------------------------------------------------------

  async transferPdf(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<PrintableFile> {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      select: {
        id: true,
        transferNumber: true,
        type: true,
        status: true,
        transferDate: true,
        notes: true,
        sourceBranchId: true,
        destinationBranchId: true,
        sourceBranch: { select: { code: true, name: true } },
        sourceWarehouse: { select: { code: true, name: true } },
        sourceLocation: { select: { code: true } },
        destinationBranch: { select: { code: true, name: true } },
        destinationWarehouse: { select: { code: true, name: true } },
        destinationLocation: { select: { code: true } },
        reason: { select: { name: true } },
        createdBy: { select: { displayName: true } },
        approvedBy: { select: { displayName: true } },
        dispatchedBy: { select: { displayName: true } },
        dispatchedAt: true,
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: {
            lineNumber: true,
            quantity: true,
            dispatchedQuantity: true,
            receivedQuantity: true,
            damagedQuantity: true,
            shortQuantity: true,
            item: { select: { sku: true, name: true } },
            asset: {
              select: { assetTag: true, item: { select: { name: true } } },
            },
            lot: { select: { lotNumber: true } },
            uom: { select: { code: true } },
          },
        },
      },
    });
    const visible =
      transfer &&
      (this.branchScope.canAccess(user, transfer.sourceBranchId) ||
        this.branchScope.canAccess(user, transfer.destinationBranchId));
    if (!transfer || !visible) {
      throw AppException.notFound('Transfer not found.');
    }

    const buffer = await renderPrintableDocument({
      title: 'TRANSFER DOCUMENT',
      documentNumber: transfer.transferNumber,
      subtitle: `Type: ${transfer.type} · Status: ${transfer.status}`,
      fieldGroups: [
        [
          {
            label: 'From',
            value: `${transfer.sourceBranch.code} / ${transfer.sourceWarehouse.name}${
              transfer.sourceLocation ? ` / ${transfer.sourceLocation.code}` : ''
            }`,
          },
          {
            label: 'To',
            value: `${transfer.destinationBranch.code}${
              transfer.destinationWarehouse
                ? ` / ${transfer.destinationWarehouse.name}`
                : ''
            }${
              transfer.destinationLocation
                ? ` / ${transfer.destinationLocation.code}`
                : ''
            }`,
          },
          { label: 'Transfer date', value: dateOnly(transfer.transferDate) },
          { label: 'Reason', value: transfer.reason?.name ?? null },
          { label: 'Created by', value: transfer.createdBy.displayName },
          { label: 'Approved by', value: transfer.approvedBy?.displayName ?? null },
          { label: 'Dispatched at', value: dateTime(transfer.dispatchedAt) },
        ],
      ],
      tables: [
        {
          caption: 'Transfer lines',
          columns: [
            { header: '#', width: 0.4 },
            { header: 'SKU / Asset tag', width: 1.5 },
            { header: 'Description', width: 2.4 },
            { header: 'Lot', width: 0.9 },
            { header: 'UOM', width: 0.6 },
            { header: 'Qty', width: 0.7, align: 'right' },
            { header: 'Dispatched', width: 0.8, align: 'right' },
            { header: 'Received', width: 0.8, align: 'right' },
            { header: 'Dmg/Short', width: 0.8, align: 'right' },
          ],
          rows: transfer.lines.map((line) => [
            String(line.lineNumber),
            line.asset?.assetTag ?? line.item?.sku ?? null,
            line.asset?.item.name ?? line.item?.name ?? null,
            line.lot?.lotNumber ?? null,
            line.uom?.code ?? (line.asset ? 'UNIT' : null),
            line.quantity?.toString() ?? (line.asset ? '1' : null),
            line.dispatchedQuantity.toString(),
            line.receivedQuantity.toString(),
            `${line.damagedQuantity.toString()}/${line.shortQuantity.toString()}`,
          ]),
        },
      ],
      notes: transfer.notes,
      signatures: [
        {
          role: 'Dispatched by',
          name: transfer.dispatchedBy?.displayName ?? null,
        },
        { role: 'Received by', name: null },
      ],
    });

    await this.auditRender(
      ctx,
      'transfer.printed',
      transfer.id,
      transfer.sourceBranchId,
      { number: transfer.transferNumber },
    );
    return { fileName: `${transfer.transferNumber}.pdf`, buffer };
  }

  // -------------------------------------------------------------------------
  // Asset acknowledgment form
  // -------------------------------------------------------------------------

  async assetAcknowledgmentForm(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<PrintableFile> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: {
        id: true,
        assetTag: true,
        serialNumber: true,
        status: true,
        branchId: true,
        branch: { select: { code: true, name: true } },
        item: {
          select: { sku: true, name: true, category: { select: { name: true } } },
        },
        condition: { select: { name: true } },
        custodian: {
          select: { firstName: true, lastName: true, displayName: true },
        },
        department: { select: { name: true } },
        assignments: {
          orderBy: { assignedAt: 'desc' },
          take: 1,
          select: {
            assignedAt: true,
            expectedReturnAt: true,
            projectRef: true,
            issueNotes: true,
            employee: {
              select: { firstName: true, lastName: true, displayName: true },
            },
            department: { select: { name: true } },
            location: { select: { code: true, name: true } },
            assignedBy: { select: { displayName: true } },
            conditionAtIssue: { select: { name: true } },
          },
        },
      },
    });
    if (!asset || !this.branchScope.canAccess(user, asset.branchId)) {
      throw AppException.notFound('Asset not found.');
    }
    const assignment = asset.assignments[0];
    const custodianName = person(assignment?.employee) ?? person(asset.custodian);

    const buffer = await renderPrintableDocument({
      title: 'ASSET ACKNOWLEDGMENT FORM',
      documentNumber: asset.assetTag,
      subtitle: `Status: ${asset.status}`,
      fieldGroups: [
        [
          { label: 'Asset tag', value: asset.assetTag },
          { label: 'Serial number', value: asset.serialNumber },
          { label: 'Item', value: `${asset.item.sku} — ${asset.item.name}` },
          { label: 'Category', value: asset.item.category?.name ?? null },
          { label: 'Branch', value: `${asset.branch.code} — ${asset.branch.name}` },
          {
            label: 'Condition at issue',
            value: assignment?.conditionAtIssue?.name ?? asset.condition?.name ?? null,
          },
        ],
        [
          { label: 'Assigned to', value: custodianName },
          {
            label: 'Department',
            value: assignment?.department?.name ?? asset.department?.name ?? null,
          },
          {
            label: 'Location',
            value: assignment?.location
              ? `${assignment.location.code} — ${assignment.location.name}`
              : null,
          },
          { label: 'Project', value: assignment?.projectRef ?? null },
          { label: 'Assigned at', value: dateTime(assignment?.assignedAt ?? null) },
          {
            label: 'Expected return',
            value: dateTime(assignment?.expectedReturnAt ?? null),
          },
          { label: 'Issued by', value: assignment?.assignedBy.displayName ?? null },
        ],
      ],
      notes:
        (assignment?.issueNotes ? `${assignment.issueNotes}\n\n` : '') +
        'I acknowledge receipt of the asset described above in the stated ' +
        'condition. I agree to keep it in good working order, use it for ' +
        'authorized company purposes only, and return it upon request, ' +
        'reassignment, or separation. Loss or damage must be reported ' +
        'immediately through GEM ERP.',
      signatures: [
        { role: 'Received by (Custodian)', name: custodianName },
        {
          role: 'Issued by',
          name: assignment?.assignedBy.displayName ?? null,
        },
      ],
    });

    await this.auditRender(
      ctx,
      'asset.acknowledgment_form_printed',
      asset.id,
      asset.branchId,
      { assetTag: asset.assetTag },
    );
    return { fileName: `${asset.assetTag}-acknowledgment.pdf`, buffer };
  }

  // -------------------------------------------------------------------------
  // Maintenance work order
  // -------------------------------------------------------------------------

  async workOrderPdf(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<PrintableFile> {
    const wo = await this.prisma.maintenanceWorkOrder.findUnique({
      where: { id },
      select: {
        id: true,
        workOrderNumber: true,
        status: true,
        branchId: true,
        problemDescription: true,
        diagnosis: true,
        actionTaken: true,
        resolution: true,
        laborCost: true,
        partsCost: true,
        externalCost: true,
        totalCost: true,
        downtimeMinutes: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        actualStartAt: true,
        actualEndAt: true,
        reportedAt: true,
        branch: { select: { code: true, name: true } },
        asset: {
          select: {
            assetTag: true,
            serialNumber: true,
            item: { select: { name: true } },
          },
        },
        type: { select: { name: true } },
        priority: { select: { name: true } },
        reportedBy: { select: { displayName: true } },
        assignedToEmployee: {
          select: { firstName: true, lastName: true, displayName: true },
        },
        assignedVendor: { select: { legalName: true } },
        assignedTeam: true,
        completedBy: { select: { displayName: true } },
        verifiedBy: { select: { displayName: true } },
        tasks: {
          orderBy: { sequence: 'asc' },
          select: { sequence: true, name: true, isRequired: true, isCompleted: true },
        },
        parts: {
          select: {
            quantity: true,
            unitCost: true,
            totalCost: true,
            item: { select: { sku: true, name: true } },
            uom: { select: { code: true } },
          },
        },
      },
    });
    if (!wo || !this.branchScope.canAccess(user, wo.branchId)) {
      throw AppException.notFound('Work order not found.');
    }
    const includeCost =
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.maintenanceWorkOrder.viewCost);

    const assignee =
      person(wo.assignedToEmployee) ??
      wo.assignedVendor?.legalName ??
      wo.assignedTeam;

    const tables: DocTable[] = [];
    if (wo.tasks.length > 0) {
      tables.push({
        caption: 'Checklist',
        columns: [
          { header: '#', width: 0.4 },
          { header: 'Task', width: 4 },
          { header: 'Required', width: 0.8 },
          { header: 'Done', width: 0.6 },
        ],
        rows: wo.tasks.map((task) => [
          String(task.sequence),
          task.name,
          task.isRequired ? 'Yes' : 'No',
          task.isCompleted ? 'Yes' : 'No',
        ]),
      });
    }
    tables.push({
      caption: 'Parts consumed',
      columns: [
        { header: 'SKU', width: 1.2 },
        { header: 'Part', width: 2.6 },
        { header: 'Qty', width: 0.7, align: 'right' },
        { header: 'UOM', width: 0.6 },
        ...(includeCost
          ? [
              { header: 'Unit cost', width: 0.9, align: 'right' as const },
              { header: 'Total cost', width: 0.9, align: 'right' as const },
            ]
          : []),
      ],
      rows: wo.parts.map((part) => [
        part.item.sku,
        part.item.name,
        part.quantity.toString(),
        part.uom.code,
        ...(includeCost ? [money(part.unitCost), money(part.totalCost)] : []),
      ]),
      ...(includeCost
        ? {
            totals: [
              ['Labor cost', money(wo.laborCost) ?? '—'],
              ['Parts cost', money(wo.partsCost) ?? '—'],
              ['External cost', money(wo.externalCost) ?? '—'],
              ['Total cost', money(wo.totalCost) ?? '—'],
            ] as Array<[string, string]>,
          }
        : {}),
    });

    const buffer = await renderPrintableDocument({
      title: 'MAINTENANCE WORK ORDER',
      documentNumber: wo.workOrderNumber,
      subtitle: `Status: ${wo.status}`,
      fieldGroups: [
        [
          {
            label: 'Asset',
            value: `${wo.asset.assetTag} — ${wo.asset.item.name}`,
          },
          { label: 'Serial number', value: wo.asset.serialNumber },
          { label: 'Branch', value: `${wo.branch.code} — ${wo.branch.name}` },
          { label: 'Type', value: wo.type.name },
          { label: 'Priority', value: wo.priority?.name ?? null },
          { label: 'Assigned to', value: assignee },
          { label: 'Reported by', value: wo.reportedBy?.displayName ?? null },
          { label: 'Reported at', value: dateTime(wo.reportedAt) },
          { label: 'Scheduled start', value: dateTime(wo.scheduledStartAt) },
          { label: 'Scheduled end', value: dateTime(wo.scheduledEndAt) },
          { label: 'Actual start', value: dateTime(wo.actualStartAt) },
          { label: 'Actual end', value: dateTime(wo.actualEndAt) },
          {
            label: 'Downtime',
            value:
              wo.downtimeMinutes !== null ? `${wo.downtimeMinutes} minutes` : null,
          },
        ],
        [
          { label: 'Problem', value: wo.problemDescription },
          { label: 'Diagnosis', value: wo.diagnosis },
          { label: 'Action taken', value: wo.actionTaken },
          { label: 'Resolution', value: wo.resolution },
        ],
      ],
      tables,
      signatures: [
        { role: 'Technician', name: assignee ?? null },
        { role: 'Completed by', name: wo.completedBy?.displayName ?? null },
        { role: 'Verified by', name: wo.verifiedBy?.displayName ?? null },
      ],
    });

    await this.auditRender(
      ctx,
      'maintenance_work_order.printed',
      wo.id,
      wo.branchId,
      { number: wo.workOrderNumber },
    );
    return { fileName: `${wo.workOrderNumber}.pdf`, buffer };
  }

  // -------------------------------------------------------------------------
  // Count sheet
  // -------------------------------------------------------------------------

  async countSheet(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<PrintableFile> {
    const session = await this.prisma.inventoryCountSession.findUnique({
      where: { id },
      select: {
        id: true,
        countNumber: true,
        type: true,
        status: true,
        isBlind: true,
        branchId: true,
        snapshotAt: true,
        startedAt: true,
        notes: true,
        branch: { select: { code: true, name: true } },
        warehouse: { select: { code: true, name: true } },
        storageLocation: { select: { code: true, name: true } },
        category: { select: { name: true } },
        createdBy: { select: { displayName: true } },
        lines: {
          orderBy: { createdAt: 'asc' },
          select: {
            item: { select: { sku: true, name: true } },
            asset: {
              select: { assetTag: true, item: { select: { name: true } } },
            },
            lot: { select: { lotNumber: true } },
            warehouse: { select: { code: true } },
            storageLocation: { select: { code: true } },
            uom: { select: { code: true } },
            expectedQuantity: true,
          },
        },
      },
    });
    if (!session || !this.branchScope.canAccess(user, session.branchId)) {
      throw AppException.notFound('Count session not found.');
    }
    // Blind sessions hide expected quantities while counting is open —
    // mirrors the count module's masking rule (spec §17).
    const maskExpected =
      session.isBlind &&
      (session.status === InventoryCountStatus.DRAFT ||
        session.status === InventoryCountStatus.IN_PROGRESS);

    const buffer = await renderPrintableDocument({
      title: 'INVENTORY COUNT SHEET',
      documentNumber: session.countNumber,
      subtitle: `Type: ${session.type} · ${session.isBlind ? 'Blind count' : 'Open count'} · Status: ${session.status}`,
      fieldGroups: [
        [
          {
            label: 'Branch',
            value: `${session.branch.code} — ${session.branch.name}`,
          },
          {
            label: 'Warehouse',
            value: session.warehouse
              ? `${session.warehouse.code} — ${session.warehouse.name}`
              : 'All warehouses',
          },
          {
            label: 'Location',
            value: session.storageLocation
              ? `${session.storageLocation.code} — ${session.storageLocation.name}`
              : null,
          },
          { label: 'Category scope', value: session.category?.name ?? null },
          { label: 'Snapshot at', value: dateTime(session.snapshotAt) },
          { label: 'Started at', value: dateTime(session.startedAt) },
          { label: 'Prepared by', value: session.createdBy.displayName },
        ],
      ],
      tables: [
        {
          caption: `Count lines (${session.lines.length})`,
          columns: [
            { header: '#', width: 0.4 },
            { header: 'SKU / Asset tag', width: 1.4 },
            { header: 'Description', width: 2.4 },
            { header: 'Lot', width: 0.9 },
            { header: 'WH', width: 0.6 },
            { header: 'Location', width: 0.8 },
            { header: 'UOM', width: 0.6 },
            { header: 'Expected', width: 0.8, align: 'right' },
            { header: 'Counted', width: 0.9, align: 'right' },
            { header: 'Remarks', width: 1 },
          ],
          rows: session.lines.map((line, index) => [
            String(index + 1),
            line.asset?.assetTag ?? line.item?.sku ?? null,
            line.asset?.item.name ?? line.item?.name ?? null,
            line.lot?.lotNumber ?? null,
            line.warehouse?.code ?? null,
            line.storageLocation?.code ?? null,
            line.uom?.code ?? (line.asset ? 'UNIT' : null),
            maskExpected ? '' : (line.expectedQuantity?.toString() ?? null),
            '', // written by hand
            '', // written by hand
          ]),
        },
      ],
      notes: session.notes,
      signatures: [
        { role: 'Counted by', name: null },
        { role: 'Verified by', name: null },
      ],
    });

    await this.auditRender(
      ctx,
      'count_session.sheet_printed',
      session.id,
      session.branchId,
      { number: session.countNumber, masked: maskExpected },
    );
    return { fileName: `${session.countNumber}-count-sheet.pdf`, buffer };
  }

  // -------------------------------------------------------------------------

  private async auditRender(
    ctx: AuditContext,
    action: string,
    resourceId: string,
    branchId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.log({
      ...ctx,
      action,
      resourceType: action.split('.')[0],
      resourceId,
      branchId,
      metadata: { ...metadata, rendered: 'pdf' },
    });
  }
}
