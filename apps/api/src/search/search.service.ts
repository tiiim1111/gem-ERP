import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import type { QuerySearchDto } from './dto/query-search.dto';
import type {
  SearchEntityType,
  SearchResponse,
  SearchResult,
} from './search-entities';

const P = PERMISSIONS;

/**
 * Global search (api-outline §4.7): one query fanned out across every entity
 * type the CALLER may see — per-entity permission filtering, branch scoping,
 * and a hard per-type result bound. Entity types the user lacks permission
 * for are silently skipped (no partial errors, no existence leaks).
 *
 * Work orders additionally honor the maintenance technician scoping rule
 * (§6.2): callers without maintenance.work_order.manage only match WOs
 * assigned to them.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  async search(user: AuthUser, query: QuerySearchDto): Promise<SearchResponse> {
    const q = query.q;
    const limit = query.limit ?? 5;
    const wanted = (type: SearchEntityType): boolean =>
      !query.type || query.type === type;

    const groups = await Promise.all([
      wanted('asset') ? this.searchAssets(user, q, limit) : [],
      wanted('item') ? this.searchItems(user, q, limit) : [],
      wanted('employee') ? this.searchEmployees(user, q, limit) : [],
      wanted('supplier') ? this.searchSuppliers(user, q, limit) : [],
      wanted('purchase_order') ? this.searchPurchaseOrders(user, q, limit) : [],
      wanted('goods_receipt') ? this.searchGoodsReceipts(user, q, limit) : [],
      wanted('maintenance_work_order')
        ? this.searchWorkOrders(user, q, limit)
        : [],
      wanted('transfer') ? this.searchTransfers(user, q, limit) : [],
      wanted('stock_transaction')
        ? this.searchStockTransactions(user, q, limit)
        : [],
    ]);
    return {
      query: q,
      limitPerType: limit,
      results: groups.flat(),
    };
  }

  // -------------------------------------------------------------- per entity

  private can(user: AuthUser, permission: string): boolean {
    return user.isSuperAdmin || user.permissions.includes(permission);
  }

  private async searchAssets(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.asset.view)) {
      return [];
    }
    const rows = await this.prisma.asset.findMany({
      where: {
        archivedAt: null,
        branchId: this.branchScope.branchFilter(user),
        OR: [
          { assetTag: { contains: q, mode: 'insensitive' } },
          { serialNumber: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { assetTag: 'asc' },
      take: limit,
      select: {
        id: true,
        assetTag: true,
        serialNumber: true,
        status: true,
        branchId: true,
        item: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      type: 'asset' as const,
      id: row.id,
      title: row.assetTag,
      subtitle: row.serialNumber
        ? `${row.item.name} — SN ${row.serialNumber}`
        : row.item.name,
      status: row.status,
      branchId: row.branchId,
    }));
  }

  private async searchItems(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.item.view)) {
      return [];
    }
    const rows = await this.prisma.item.findMany({
      where: {
        archivedAt: null,
        OR: [
          { sku: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          {
            barcodes: {
              some: {
                active: true,
                barcode: { contains: q, mode: 'insensitive' },
              },
            },
          },
        ],
      },
      orderBy: { sku: 'asc' },
      take: limit,
      select: { id: true, sku: true, name: true, isActive: true },
    });
    return rows.map((row) => ({
      type: 'item' as const,
      id: row.id,
      title: row.sku,
      subtitle: row.name,
      status: row.isActive ? 'ACTIVE' : 'INACTIVE',
      branchId: null,
    }));
  }

  private async searchEmployees(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.employee.view)) {
      return [];
    }
    const rows = await this.prisma.employee.findMany({
      where: {
        archivedAt: null,
        branchId: this.branchScope.branchFilter(user),
        OR: [
          { employeeNumber: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { employeeNumber: 'asc' },
      take: limit,
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        displayName: true,
        status: true,
        branchId: true,
      },
    });
    return rows.map((row) => ({
      type: 'employee' as const,
      id: row.id,
      title: row.displayName ?? `${row.firstName} ${row.lastName}`,
      subtitle: row.employeeNumber,
      status: row.status,
      branchId: row.branchId,
    }));
  }

  private async searchSuppliers(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.supplier.view)) {
      return [];
    }
    const rows = await this.prisma.supplier.findMany({
      where: {
        archivedAt: null,
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { legalName: { contains: q, mode: 'insensitive' } },
          { tradeName: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { code: 'asc' },
      take: limit,
      select: {
        id: true,
        code: true,
        legalName: true,
        tradeName: true,
        isActive: true,
      },
    });
    return rows.map((row) => ({
      type: 'supplier' as const,
      id: row.id,
      title: row.legalName,
      subtitle: row.tradeName ? `${row.code} — ${row.tradeName}` : row.code,
      status: row.isActive ? 'ACTIVE' : 'INACTIVE',
      branchId: null,
    }));
  }

  private async searchPurchaseOrders(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.procurementPo.view)) {
      return [];
    }
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        branchId: this.branchScope.branchFilter(user),
        poNumber: { contains: q, mode: 'insensitive' },
      },
      orderBy: { poNumber: 'desc' },
      take: limit,
      select: {
        id: true,
        poNumber: true,
        status: true,
        branchId: true,
        supplier: { select: { legalName: true } },
      },
    });
    return rows.map((row) => ({
      type: 'purchase_order' as const,
      id: row.id,
      title: row.poNumber,
      subtitle: row.supplier.legalName,
      status: row.status,
      branchId: row.branchId,
    }));
  }

  private async searchGoodsReceipts(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.procurementReceipt.view)) {
      return [];
    }
    const rows = await this.prisma.goodsReceipt.findMany({
      where: {
        branchId: this.branchScope.branchFilter(user),
        receiptNumber: { contains: q, mode: 'insensitive' },
      },
      orderBy: { receiptNumber: 'desc' },
      take: limit,
      select: {
        id: true,
        receiptNumber: true,
        status: true,
        branchId: true,
        purchaseOrder: { select: { poNumber: true } },
      },
    });
    return rows.map((row) => ({
      type: 'goods_receipt' as const,
      id: row.id,
      title: row.receiptNumber,
      subtitle: row.purchaseOrder.poNumber,
      status: row.status,
      branchId: row.branchId,
    }));
  }

  private async searchWorkOrders(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.maintenanceWorkOrder.view)) {
      return [];
    }
    const where: Prisma.MaintenanceWorkOrderWhereInput = {
      branchId: this.branchScope.branchFilter(user),
      workOrderNumber: { contains: q, mode: 'insensitive' },
    };
    // Technician scoping (§6.2): view-only callers match own WOs only.
    if (!this.can(user, P.maintenanceWorkOrder.manage)) {
      where.assignedToEmployee = { userId: user.id };
    }
    const rows = await this.prisma.maintenanceWorkOrder.findMany({
      where,
      orderBy: { workOrderNumber: 'desc' },
      take: limit,
      select: {
        id: true,
        workOrderNumber: true,
        status: true,
        branchId: true,
        asset: { select: { assetTag: true } },
      },
    });
    return rows.map((row) => ({
      type: 'maintenance_work_order' as const,
      id: row.id,
      title: row.workOrderNumber,
      subtitle: row.asset.assetTag,
      status: row.status,
      branchId: row.branchId,
    }));
  }

  private async searchTransfers(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.transfer.view)) {
      return [];
    }
    const branchFilter = this.branchScope.branchFilter(user);
    const rows = await this.prisma.transfer.findMany({
      where: {
        transferNumber: { contains: q, mode: 'insensitive' },
        ...(branchFilter
          ? {
              OR: [
                { sourceBranchId: branchFilter },
                { destinationBranchId: branchFilter },
              ],
            }
          : {}),
      },
      orderBy: { transferNumber: 'desc' },
      take: limit,
      select: {
        id: true,
        transferNumber: true,
        status: true,
        sourceBranchId: true,
      },
    });
    return rows.map((row) => ({
      type: 'transfer' as const,
      id: row.id,
      title: row.transferNumber,
      subtitle: null,
      status: row.status,
      branchId: row.sourceBranchId,
    }));
  }

  private async searchStockTransactions(
    user: AuthUser,
    q: string,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.can(user, P.inventory.view)) {
      return [];
    }
    const rows = await this.prisma.stockTransaction.findMany({
      where: {
        branchId: this.branchScope.branchFilter(user),
        transactionNumber: { contains: q, mode: 'insensitive' },
      },
      orderBy: { transactionNumber: 'desc' },
      take: limit,
      select: {
        id: true,
        transactionNumber: true,
        type: true,
        status: true,
        branchId: true,
      },
    });
    return rows.map((row) => ({
      type: 'stock_transaction' as const,
      id: row.id,
      title: row.transactionNumber,
      subtitle: row.type,
      status: row.status,
      branchId: row.branchId,
    }));
  }
}
