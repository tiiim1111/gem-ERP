import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type {
  ReportColumn,
  ReportFilterKey,
  ReportFilters,
  ReportRow,
} from '@gemerp/reports';
import {
  getReportDefinition,
  validateReportFilters,
} from '@gemerp/reports';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated } from '../common/pagination';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import {
  canRunReport,
  includeCostColumns,
  runnableReports,
} from './report-access';
import { filtersFrom, ReportQueryDto } from './dto/report-query.dto';

/** One catalog entry: everything the web needs to render a report page. */
export interface ReportCatalogEntry {
  key: string;
  title: string;
  description: string;
  /** Underlying permission (informational — the caller already holds it). */
  permission: string;
  /** Whether THIS caller will receive the cost columns. */
  includesCost: boolean;
  filters: readonly ReportFilterKey[];
  statusOptions?: readonly string[];
  columns: Array<Pick<ReportColumn, 'key' | 'header' | 'cost'>>;
}

/**
 * GET /reports + GET /reports/:key (api-outline §8). Every report runs off
 * the shared @gemerp/reports registry: permission checks (report.view via
 * the route guard PLUS the definition's underlying permission), branch
 * scoping, filter validation, cost gating, and pagination.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  /** The caller's runnable subset of the report catalog. */
  catalog(user: AuthUser): ReportCatalogEntry[] {
    return runnableReports(user).map((definition) => {
      const includesCost = includeCostColumns(user, definition);
      return {
        key: definition.key,
        title: definition.title,
        description: definition.description,
        permission: definition.permission,
        includesCost,
        filters: definition.filters,
        ...(definition.statusOptions
          ? { statusOptions: definition.statusOptions }
          : {}),
        columns: definition.columns
          .filter((column) => !column.cost || includesCost)
          .map(({ key, header, cost }) => ({
            key,
            header,
            ...(cost ? { cost } : {}),
          })),
      };
    });
  }

  async run(
    user: AuthUser,
    key: string,
    query: ReportQueryDto,
  ): Promise<Paginated<ReportRow>> {
    const definition = getReportDefinition(key);
    if (!definition) {
      throw AppException.notFound(`Unknown report "${key}".`);
    }
    if (!canRunReport(user, definition)) {
      throw AppException.forbidden(
        'You do not have permission to run this report.',
      );
    }
    if (query.sort) {
      throw AppException.validation([
        {
          field: 'sort',
          message: 'reports use a fixed sort order; sort is not configurable.',
        },
      ]);
    }
    const filters = filtersFrom(query) as ReportFilters;
    const errors = validateReportFilters(definition, filters);
    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
    if (filters.branchId) {
      this.branchScope.assertBranchAccess(user, filters.branchId);
    }
    const { page, pageSize, skip, take } = pageArgs(query);
    const result = await definition.run(this.prisma, {
      branchIds: this.branchScope.branchIdsFor(user),
      filters,
      includeCost: includeCostColumns(user, definition),
      skip,
      take,
    });
    return paginated(result.rows, page, pageSize, result.total);
  }
}
