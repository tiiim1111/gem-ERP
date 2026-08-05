import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import {
  CreateSupplierDto,
  QuerySuppliersDto,
  SupplierContactDto,
  UpdateSupplierContactDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import {
  SupplierContactView,
  SupplierDetailView,
  SupplierHistoryView,
  SuppliersService,
  SupplierView,
} from './suppliers.service';

@ApiTags('suppliers')
@ApiCookieAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.supplier.view)
  @ApiOperation({
    summary:
      'List suppliers (filters: q, categoryId, isActive, includeArchived). Global resource.',
  })
  list(@Query() query: QuerySuppliersDto): Promise<Paginated<SupplierView>> {
    return this.suppliers.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.supplier.create)
  @ApiOperation({
    summary:
      'Create a supplier (code auto-generated as SUP-{SEQ5} when omitted; optional inline contacts).',
  })
  create(
    @Body() dto: CreateSupplierDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierView> {
    return this.suppliers.create(dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.supplier.view)
  @ApiOperation({
    summary:
      'Supplier detail with contacts and the purchase & delivery summary (totals need procurement.po.view_cost).',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierDetailView> {
    return this.suppliers.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.supplier.update)
  @ApiOperation({
    summary:
      'Edit supplier master data (code is immutable; last-write-wins, fully audited).',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierView> {
    return this.suppliers.update(id, dto, auditContextFrom(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.supplier.update)
  @ApiOperation({ summary: 'Reactivate a supplier for new documents.' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierView> {
    return this.suppliers.setActive(id, true, auditContextFrom(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.supplier.update)
  @ApiOperation({
    summary:
      'Deactivate without losing history — the supplier stays on past documents but blocks new POs.',
  })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierView> {
    return this.suppliers.setActive(id, false, auditContextFrom(req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.supplier.archive)
  @ApiOperation({
    summary:
      'Soft-archive (never delete). Blocked while open purchase orders exist (409 IN_USE).',
  })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierView> {
    return this.suppliers.archive(id, auditContextFrom(req));
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.procurementPo.view)
  @ApiOperation({
    summary:
      'Purchase & delivery history rollup: PO counts by status, recent POs and receipts (values need procurement.po.view_cost).',
  })
  history(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierHistoryView> {
    return this.suppliers.history(user, id);
  }

  // ---------------------------------------------------------------------
  // Contacts sub-resource
  // ---------------------------------------------------------------------

  @Get(':id/contacts')
  @RequirePermissions(PERMISSIONS.supplier.view)
  @ApiOperation({ summary: 'Contact people of a supplier.' })
  listContacts(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierContactView[]> {
    return this.suppliers.listContacts(id);
  }

  @Post(':id/contacts')
  @RequirePermissions(PERMISSIONS.supplier.update)
  @ApiOperation({
    summary: 'Add a contact (marking one primary demotes the previous).',
  })
  addContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupplierContactDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierContactView> {
    return this.suppliers.addContact(id, dto, auditContextFrom(req));
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermissions(PERMISSIONS.supplier.update)
  @ApiOperation({ summary: 'Edit a contact person.' })
  updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateSupplierContactDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierContactView> {
    return this.suppliers.updateContact(
      id,
      contactId,
      dto,
      auditContextFrom(req),
    );
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.supplier.update)
  @ApiOperation({ summary: 'Remove a contact person.' })
  async removeContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.suppliers.removeContact(id, contactId, auditContextFrom(req));
  }
}
