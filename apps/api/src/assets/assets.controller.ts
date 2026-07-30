import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { AssetLifecycleService } from './asset-lifecycle.service';
import {
  AssetDetailView,
  AssetHistoryEntry,
  AssetsService,
  AssetView,
  AssignmentView,
} from './assets.service';
import {
  AcknowledgeAssetDto,
  AssignAssetDto,
  CompleteMaintenanceDto,
  DisposeAssetDto,
  InspectAssetDto,
  ReasonDto,
  ReportIncidentDto,
  ReturnAssetDto,
  StatusNoteDto,
  TransferAssetDto,
} from './dto/asset-actions.dto';
import { BatchLabelsDto, LabelQueryDto } from './dto/label.dto';
import { QueryAssetsDto } from './dto/query-assets.dto';
import { RegisterAssetDto } from './dto/register-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { LabelService } from './label.service';

/**
 * Serialized assets (api-outline 4.3). Lifecycle changes happen ONLY through
 * the action endpoints — PATCH edits non-lifecycle fields. All routes are
 * branch-scoped; out-of-scope assets read as 404.
 */
@ApiTags('assets')
@ApiCookieAuth()
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly lifecycle: AssetLifecycleService,
    private readonly labels: LabelService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.asset.view)
  @ApiOperation({
    summary:
      'List assets (branch-scoped; filters: q on tag/serial/item name, branchId, warehouseId, status, conditionId, itemId, categoryId, custodianEmployeeId, departmentId, warrantyExpiringDays).',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryAssetsDto,
  ): Promise<Paginated<AssetView>> {
    return this.assets.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.asset.create)
  @ApiOperation({
    summary:
      'Register asset instance(s) of a SERIAL-tracked item. Bulk via `quantity` (tags AST-{BRANCH}-{CAT}-{YYYY}-{SEQ6} + scan tokens generated atomically). Returns the created assets.',
  })
  async register(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterAssetDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetView | { assets: AssetView[]; count: number }> {
    const created = await this.assets.register(user, dto, auditContextFrom(req));
    return created.length === 1
      ? created[0]
      : { assets: created, count: created.length };
  }

  @Post('labels/batch')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.print)
  @ApiOperation({
    summary:
      'Batch label sheet — one printable HTML page of SVG labels for the given assets.',
  })
  @ApiProduces('text/html')
  async batchLabels(
    @CurrentUser() user: AuthUser,
    @Body() dto: BatchLabelsDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const rendered = await this.labels.renderBatch(
      user,
      dto,
      auditContextFrom(req),
    );
    res.setHeader('Content-Type', rendered.contentType);
    return rendered.body as string;
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.asset.view)
  @ApiOperation({
    summary:
      'Asset detail: item, custody, location, warranty, condition, open assignment, permitted actions (404 out of scope).',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssetDetailView> {
    return this.assets.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.asset.update)
  @ApiOperation({
    summary:
      'Edit non-lifecycle fields (requires current `version`; Draft fully editable, active assets only warranty/criticality/serial/notes).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetView> {
    return this.assets.update(user, id, dto, auditContextFrom(req));
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.asset.view)
  @ApiOperation({ summary: 'Unified status/condition/location timeline.' })
  history(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssetHistoryEntry[]> {
    return this.assets.history(user, id);
  }

  @Get(':id/assignments')
  @RequirePermissions(PERMISSIONS.asset.view)
  @ApiOperation({ summary: 'Custody history including acknowledgments.' })
  assignments(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssignmentView[]> {
    return this.assets.assignments(user, id);
  }

  @Get(':id/label')
  @RequirePermissions(PERMISSIONS.asset.print)
  @ApiOperation({
    summary:
      'Printable label: Code 128 of the tag + QR of the opaque scan URL + tag/item/"Property of GemCor" text. ?format=svg|png&size=2x1|3x2.',
  })
  @ApiProduces('image/svg+xml', 'image/png')
  async label(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LabelQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Buffer | string> {
    const rendered = await this.labels.renderOne(
      user,
      id,
      query.format ?? 'svg',
      query.size ?? '2x1',
      auditContextFrom(req),
    );
    res.setHeader('Content-Type', rendered.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${rendered.filename}"`,
    );
    return rendered.body;
  }

  // ------------------------------------------------------------------
  // Lifecycle actions (docs/status-transitions.md §1)
  // ------------------------------------------------------------------

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.create)
  @ApiOperation({ summary: 'Draft → Available (required fields must be complete).' })
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.activate(user, id, auditContextFrom(req));
  }

  @Post(':id/reserve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.assign)
  @ApiOperation({ summary: 'Available → Reserved.' })
  reserve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusNoteDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.reserve(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/release')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.assign)
  @ApiOperation({ summary: 'Reserved → Available (release the reservation).' })
  release(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusNoteDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.release(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.assign)
  @ApiOperation({
    summary:
      'Assign to employee/department/location/project: condition at issuance + expected return date; employee custody starts pending acknowledgment.',
  })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.assign(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Custodian (linked user) confirms receipt; or an authorized user records a captured acknowledgment (notes required).',
  })
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcknowledgeAssetDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.acknowledge(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/return')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.assign)
  @ApiOperation({
    summary:
      'Return from custody: condition at return + notes → Available (or Damaged per condition/flag).',
  })
  return_(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnAssetDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.return_(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.transfer)
  @ApiOperation({
    summary:
      'Employee-to-employee reassignment (employeeId) OR location/warehouse/branch move (movement rows with from/to written either way).',
  })
  transfer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferAssetDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.transfer(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/send-to-inspection')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.inspect)
  @ApiOperation({ summary: 'Available/Assigned/Damaged → Under Inspection.' })
  sendToInspection(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusNoteDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.sendToInspection(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/inspect')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.inspect)
  @ApiOperation({
    summary:
      'Record the inspection outcome: PASS → Available, FAIL → Damaged (findings required; may flag maintenance).',
  })
  inspect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InspectAssetDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.inspect(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/send-to-maintenance')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.manage)
  @ApiOperation({
    summary:
      'Status flag → Under Maintenance (work orders arrive in Phase 5).',
  })
  sendToMaintenance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusNoteDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.sendToMaintenance(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/complete-maintenance')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.manage)
  @ApiOperation({
    summary:
      'Under Maintenance → chosen outcome (Available/Assigned/Damaged/Retired; Retired also needs asset.retire).',
  })
  completeMaintenance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteMaintenanceDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.completeMaintenance(
      user,
      id,
      dto,
      auditContextFrom(req),
    );
  }

  @Post(':id/report-damage')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.reportIncident)
  @ApiOperation({
    summary:
      'Damage declaration (description mandatory) → Damaged; any active assignment is closed with a condition record.',
  })
  reportDamage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportIncidentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.reportDamage(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/report-loss')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.reportIncident)
  @ApiOperation({
    summary:
      'Loss declaration (description mandatory) → Lost; the assignment is closed and flagged LOST, never marked returned.',
  })
  reportLoss(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportIncidentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.reportLoss(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/recover')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.update)
  @ApiOperation({
    summary:
      'Authorized recovery: Lost → Under Inspection (reason mandatory; a lost asset never returns to Available directly).',
  })
  recover(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.recover(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/retire')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.retire)
  @ApiOperation({
    summary:
      'Available/Damaged → Retired (reason mandatory); from Lost this is the write-off.',
  })
  retire(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.retire(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/dispose')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.dispose)
  @ApiOperation({
    summary:
      'Retired → Disposed: disposal method (lookup) + reason recorded; irreversible except authorized reversal.',
  })
  dispose(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisposeAssetDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.dispose(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/reverse-disposal')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.asset.dispose)
  @ApiOperation({
    summary:
      'Authorized reversal of a posted disposal (reason mandatory): Disposed → Retired; the original disposal stays in history.',
  })
  reverseDisposal(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssetDetailView> {
    return this.lifecycle.reverseDisposal(user, id, dto, auditContextFrom(req));
  }
}
