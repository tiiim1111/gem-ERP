import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  formatSupplierCode,
  SUPPLIER_CODE_SEQUENCE_KEY,
} from './procurement-numbers';
import { canViewProcurementCost, toDateOnly } from './procurement-views';
import {
  CreateSupplierDto,
  QuerySuppliersDto,
  SupplierContactDto,
  UpdateSupplierContactDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';

const SUPPLIER_SELECT = {
  id: true,
  code: true,
  legalName: true,
  tradeName: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  country: true,
  taxId: true,
  paymentTerms: true,
  category: { select: { id: true, code: true, name: true } },
  notes: true,
  isActive: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierSelect;

const CONTACT_SELECT = {
  id: true,
  name: true,
  position: true,
  email: true,
  phone: true,
  isPrimary: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierContactSelect;

export type SupplierView = Prisma.SupplierGetPayload<{
  select: typeof SUPPLIER_SELECT;
}>;
export type SupplierContactView = Prisma.SupplierContactGetPayload<{
  select: typeof CONTACT_SELECT;
}>;

/** Purchase & delivery rollup shown on the supplier detail (spec §14). */
export interface SupplierPurchaseSummary {
  purchaseOrders: { total: number; byStatus: Record<string, number> };
  lastOrderDate: string | null;
  postedReceipts: number;
  lastDeliveryDate: string | null;
  /** Sum of grand totals of non-canceled POs — procurement.po.view_cost only. */
  totalPurchaseValue?: string;
}

export interface SupplierDetailView extends SupplierView {
  contacts: SupplierContactView[];
  summary: SupplierPurchaseSummary;
}

export interface SupplierHistoryView {
  summary: SupplierPurchaseSummary;
  recentPurchaseOrders: Array<{
    id: string;
    poNumber: string;
    status: PurchaseOrderStatus;
    orderDate: string;
    branch: { id: string; code: string; name: string };
    /** procurement.po.view_cost only. */
    grandTotal?: string;
  }>;
  recentReceipts: Array<{
    id: string;
    receiptNumber: string;
    status: string;
    receiptDate: string;
    poNumber: string;
    postedAt: Date | null;
  }>;
}

const SORTABLE = {
  code: 'code',
  legalName: 'legalName',
  createdAt: 'createdAt',
};

/**
 * Suppliers are global (non-branch) resources gated by permission only
 * (api-outline 1.7). They are never deleted: deactivate keeps them selectable
 * history-side but blocks new documents; archive hides them from default
 * lists while purchase history stays intact.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(query: QuerySuppliersDto): Promise<Paginated<SupplierView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'code',
      direction: 'asc',
    });

    const where: Prisma.SupplierWhereInput = {
      ...(query.includeArchived ? {} : { archivedAt: null }),
    };
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { legalName: { contains: query.q, mode: 'insensitive' } },
        { tradeName: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy,
        skip,
        take,
        select: SUPPLIER_SELECT,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return paginated(rows, page, pageSize, total);
  }

  async getById(user: AuthUser, id: string): Promise<SupplierDetailView> {
    const row = await this.prisma.supplier.findUnique({
      where: { id },
      select: {
        ...SUPPLIER_SELECT,
        contacts: {
          orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          select: CONTACT_SELECT,
        },
      },
    });
    if (!row) {
      throw AppException.notFound('Supplier not found.');
    }
    const summary = await this.purchaseSummary(
      id,
      canViewProcurementCost(user),
    );
    return { ...row, summary };
  }

  /** GET /suppliers/:id/history — purchase & delivery rollup (outline 5.1). */
  async history(user: AuthUser, id: string): Promise<SupplierHistoryView> {
    await this.requireSupplier(id);
    const includeCost = canViewProcurementCost(user);
    const [summary, recentPos, recentReceipts] = await Promise.all([
      this.purchaseSummary(id, includeCost),
      this.prisma.purchaseOrder.findMany({
        where: { supplierId: id },
        orderBy: { orderDate: 'desc' },
        take: 20,
        select: {
          id: true,
          poNumber: true,
          status: true,
          orderDate: true,
          grandTotal: true,
          branch: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.goodsReceipt.findMany({
        where: { purchaseOrder: { supplierId: id } },
        orderBy: { receiptDate: 'desc' },
        take: 20,
        select: {
          id: true,
          receiptNumber: true,
          status: true,
          receiptDate: true,
          postedAt: true,
          purchaseOrder: { select: { poNumber: true } },
        },
      }),
    ]);
    return {
      summary,
      recentPurchaseOrders: recentPos.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        orderDate: toDateOnly(po.orderDate) as string,
        branch: po.branch,
        ...(includeCost ? { grandTotal: po.grandTotal.toString() } : {}),
      })),
      recentReceipts: recentReceipts.map((receipt) => ({
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        status: receipt.status,
        receiptDate: toDateOnly(receipt.receiptDate) as string,
        poNumber: receipt.purchaseOrder.poNumber,
        postedAt: receipt.postedAt,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Create / update
  // -------------------------------------------------------------------------

  async create(
    dto: CreateSupplierDto,
    ctx: AuditContext,
  ): Promise<SupplierView> {
    await this.assertCategory(dto.categoryId);
    this.assertPrimaryContacts(dto.contacts);

    const explicitCode = dto.code?.trim().toUpperCase();
    if (explicitCode) {
      const clash = await this.prisma.supplier.findUnique({
        where: { code: explicitCode },
        select: { id: true },
      });
      if (clash) {
        throw AppException.duplicateCode(
          `Supplier code "${explicitCode}" is already in use.`,
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const code =
        explicitCode ??
        formatSupplierCode(
          await this.sequences.next(tx, SUPPLIER_CODE_SEQUENCE_KEY),
        );
      return tx.supplier.create({
        data: {
          code,
          legalName: dto.legalName,
          tradeName: dto.tradeName ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
          city: dto.city ?? null,
          country: dto.country?.toUpperCase() ?? 'PH',
          taxId: dto.taxId ?? null,
          paymentTerms: dto.paymentTerms ?? null,
          categoryId: dto.categoryId ?? null,
          notes: dto.notes ?? null,
          contacts:
            dto.contacts && dto.contacts.length > 0
              ? {
                  create: dto.contacts.map((contact) => ({
                    name: contact.name,
                    position: contact.position ?? null,
                    email: contact.email ?? null,
                    phone: contact.phone ?? null,
                    isPrimary: contact.isPrimary ?? false,
                  })),
                }
              : undefined,
        },
        select: SUPPLIER_SELECT,
      });
    });

    await this.audit.log({
      action: 'supplier.created',
      resourceType: 'supplier',
      resourceId: created.id,
      newValues: this.snapshot(created),
      ...ctx,
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    ctx: AuditContext,
  ): Promise<SupplierView> {
    const existing = await this.requireSupplier(id);
    this.assertNotArchived(existing);
    if (dto.categoryId) {
      await this.assertCategory(dto.categoryId);
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
        ...(dto.tradeName !== undefined ? { tradeName: dto.tradeName } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.country !== undefined
          ? { country: dto.country?.toUpperCase() ?? null }
          : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
        ...(dto.paymentTerms !== undefined
          ? { paymentTerms: dto.paymentTerms }
          : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      select: SUPPLIER_SELECT,
    });

    await this.audit.log({
      action: 'supplier.updated',
      resourceType: 'supplier',
      resourceId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
      ...ctx,
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Activate / deactivate / archive (never delete)
  // -------------------------------------------------------------------------

  async setActive(
    id: string,
    isActive: boolean,
    ctx: AuditContext,
  ): Promise<SupplierView> {
    const existing = await this.requireSupplier(id);
    this.assertNotArchived(existing);
    if (existing.isActive === isActive) {
      return existing;
    }
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: { isActive },
      select: SUPPLIER_SELECT,
    });
    await this.audit.log({
      action: isActive ? 'supplier.activated' : 'supplier.deactivated',
      resourceType: 'supplier',
      resourceId: id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive },
      ...ctx,
    });
    return updated;
  }

  async archive(id: string, ctx: AuditContext): Promise<SupplierView> {
    const existing = await this.requireSupplier(id);
    if (existing.archivedAt) {
      return existing;
    }
    const openPo = await this.prisma.purchaseOrder.findFirst({
      where: {
        supplierId: id,
        status: {
          in: [
            PurchaseOrderStatus.DRAFT,
            PurchaseOrderStatus.PENDING_APPROVAL,
            PurchaseOrderStatus.APPROVED,
            PurchaseOrderStatus.PARTIALLY_RECEIVED,
          ],
        },
      },
      select: { poNumber: true },
    });
    if (openPo) {
      throw AppException.inUse(
        `Supplier has open purchase orders (e.g. ${openPo.poNumber}) — close or cancel them before archiving.`,
      );
    }
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
      select: SUPPLIER_SELECT,
    });
    await this.audit.log({
      action: 'supplier.archived',
      resourceType: 'supplier',
      resourceId: id,
      oldValues: { archivedAt: null, isActive: existing.isActive },
      newValues: { archivedAt: updated.archivedAt, isActive: false },
      ...ctx,
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Contacts sub-resource
  // -------------------------------------------------------------------------

  async listContacts(supplierId: string): Promise<SupplierContactView[]> {
    await this.requireSupplier(supplierId);
    return this.prisma.supplierContact.findMany({
      where: { supplierId },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      select: CONTACT_SELECT,
    });
  }

  async addContact(
    supplierId: string,
    dto: SupplierContactDto,
    ctx: AuditContext,
  ): Promise<SupplierContactView> {
    const supplier = await this.requireSupplier(supplierId);
    this.assertNotArchived(supplier);
    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.supplierContact.updateMany({
          where: { supplierId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.supplierContact.create({
        data: {
          supplierId,
          name: dto.name,
          position: dto.position ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          isPrimary: dto.isPrimary ?? false,
        },
        select: CONTACT_SELECT,
      });
    });
    await this.audit.log({
      action: 'supplier.contact_added',
      resourceType: 'supplier',
      resourceId: supplierId,
      newValues: { contactId: created.id, name: created.name },
      ...ctx,
    });
    return created;
  }

  async updateContact(
    supplierId: string,
    contactId: string,
    dto: UpdateSupplierContactDto,
    ctx: AuditContext,
  ): Promise<SupplierContactView> {
    const supplier = await this.requireSupplier(supplierId);
    this.assertNotArchived(supplier);
    const existing = await this.prisma.supplierContact.findFirst({
      where: { id: contactId, supplierId },
      select: CONTACT_SELECT,
    });
    if (!existing) {
      throw AppException.notFound('Supplier contact not found.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.supplierContact.updateMany({
          where: { supplierId, isPrimary: true, id: { not: contactId } },
          data: { isPrimary: false },
        });
      }
      return tx.supplierContact.update({
        where: { id: contactId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.position !== undefined ? { position: dto.position } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: CONTACT_SELECT,
      });
    });
    await this.audit.log({
      action: 'supplier.contact_updated',
      resourceType: 'supplier',
      resourceId: supplierId,
      oldValues: existing,
      newValues: updated,
      ...ctx,
    });
    return updated;
  }

  async removeContact(
    supplierId: string,
    contactId: string,
    ctx: AuditContext,
  ): Promise<void> {
    const supplier = await this.requireSupplier(supplierId);
    this.assertNotArchived(supplier);
    const existing = await this.prisma.supplierContact.findFirst({
      where: { id: contactId, supplierId },
      select: CONTACT_SELECT,
    });
    if (!existing) {
      throw AppException.notFound('Supplier contact not found.');
    }
    await this.prisma.supplierContact.delete({ where: { id: contactId } });
    await this.audit.log({
      action: 'supplier.contact_removed',
      resourceType: 'supplier',
      resourceId: supplierId,
      oldValues: existing,
      ...ctx,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async requireSupplier(id: string): Promise<SupplierView> {
    const row = await this.prisma.supplier.findUnique({
      where: { id },
      select: SUPPLIER_SELECT,
    });
    if (!row) {
      throw AppException.notFound('Supplier not found.');
    }
    return row;
  }

  private assertNotArchived(supplier: SupplierView): void {
    if (supplier.archivedAt) {
      throw AppException.invalidStateTransition(
        'This supplier is archived and can no longer be modified.',
      );
    }
  }

  private async assertCategory(categoryId: string | undefined): Promise<void> {
    if (!categoryId) {
      return;
    }
    const value = await this.prisma.lookupValue.findUnique({
      where: { id: categoryId },
      select: { category: true, isActive: true },
    });
    if (!value || value.category !== 'SUPPLIER_CATEGORY' || !value.isActive) {
      throw AppException.validation([
        {
          field: 'categoryId',
          message: 'Must reference an active SUPPLIER_CATEGORY lookup value.',
        },
      ]);
    }
  }

  private assertPrimaryContacts(
    contacts: SupplierContactDto[] | undefined,
  ): void {
    if ((contacts ?? []).filter((contact) => contact.isPrimary).length > 1) {
      throw AppException.validation([
        {
          field: 'contacts',
          message: 'Only one contact may be marked primary.',
        },
      ]);
    }
  }

  private async purchaseSummary(
    supplierId: string,
    includeCost: boolean,
  ): Promise<SupplierPurchaseSummary> {
    const [byStatus, lastOrder, receipts, lastDelivery, spend] =
      await Promise.all([
        this.prisma.purchaseOrder.groupBy({
          by: ['status'],
          where: { supplierId },
          _count: { _all: true },
        }),
        this.prisma.purchaseOrder.findFirst({
          where: { supplierId },
          orderBy: { orderDate: 'desc' },
          select: { orderDate: true },
        }),
        this.prisma.goodsReceipt.count({
          where: { purchaseOrder: { supplierId }, status: 'POSTED' },
        }),
        this.prisma.goodsReceipt.findFirst({
          where: { purchaseOrder: { supplierId }, status: 'POSTED' },
          orderBy: { receiptDate: 'desc' },
          select: { receiptDate: true },
        }),
        includeCost
          ? this.prisma.purchaseOrder.aggregate({
              where: {
                supplierId,
                status: { not: PurchaseOrderStatus.CANCELED },
              },
              _sum: { grandTotal: true },
            })
          : Promise.resolve(null),
      ]);
    const statusCounts: Record<string, number> = {};
    let total = 0;
    for (const row of byStatus) {
      statusCounts[row.status] = row._count._all;
      total += row._count._all;
    }
    return {
      purchaseOrders: { total, byStatus: statusCounts },
      lastOrderDate: toDateOnly(lastOrder?.orderDate ?? null),
      postedReceipts: receipts,
      lastDeliveryDate: toDateOnly(lastDelivery?.receiptDate ?? null),
      ...(includeCost
        ? {
            totalPurchaseValue: (
              spend?._sum.grandTotal ?? new Prisma.Decimal(0)
            ).toString(),
          }
        : {}),
    };
  }

  private snapshot(row: SupplierView): Record<string, unknown> {
    return {
      code: row.code,
      legalName: row.legalName,
      tradeName: row.tradeName,
      email: row.email,
      phone: row.phone,
      address: row.address,
      city: row.city,
      country: row.country,
      taxId: row.taxId,
      paymentTerms: row.paymentTerms,
      categoryId: row.category?.id ?? null,
      notes: row.notes,
      isActive: row.isActive,
      archivedAt: row.archivedAt,
    };
  }
}
