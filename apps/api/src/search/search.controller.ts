import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-request';
import { QuerySearchDto } from './dto/query-search.dto';
import type { SearchResponse } from './search-entities';
import { SearchService } from './search.service';

/**
 * Global search (api-outline §4.7). Deliberately has NO @RequirePermissions:
 * the contract is "session (per-result permission filtering)" — any
 * authenticated user may call it, and the service only searches the entity
 * types the caller holds the view permission for, inside their branches.
 */
@ApiTags('search')
@ApiCookieAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary:
      'Global search across asset tags/serials, SKUs/names/barcodes, employees, suppliers, and PO/GR/WO/transfer/stock-transaction numbers — permission-filtered per entity type, branch-scoped, bounded per type.',
  })
  find(
    @CurrentUser() user: AuthUser,
    @Query() query: QuerySearchDto,
  ): Promise<SearchResponse> {
    return this.search.search(user, query);
  }
}
