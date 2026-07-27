import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ALL_PERMISSIONS, PERMISSIONS } from '@gemerp/shared';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';

export interface PermissionCatalogEntry {
  key: string;
  action: string;
  description: string;
}

export interface PermissionCatalogGroup {
  resource: string;
  permissions: PermissionCatalogEntry[];
}

function humanize(fragment: string): string {
  const words = fragment.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The catalog is static — derived once from @gemerp/shared ALL_PERMISSIONS. */
const CATALOG: PermissionCatalogGroup[] = (() => {
  const groups = new Map<string, PermissionCatalogEntry[]>();
  for (const key of ALL_PERMISSIONS) {
    const lastDot = key.lastIndexOf('.');
    const resource = key.slice(0, lastDot);
    const action = key.slice(lastDot + 1);
    const entry: PermissionCatalogEntry = {
      key,
      action,
      description: `${humanize(action)} — ${humanize(resource)}`,
    };
    const bucket = groups.get(resource);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(resource, [entry]);
    }
  }
  return [...groups.entries()].map(([resource, permissions]) => ({
    resource,
    permissions,
  }));
})();

@ApiTags('roles')
@ApiCookieAuth()
@Controller('permissions')
export class PermissionsController {
  @Get()
  @RequirePermissions(PERMISSIONS.role.view)
  @ApiOperation({
    summary: 'Full permission catalog grouped by resource (mirrors @gemerp/shared).',
  })
  catalog(): PermissionCatalogGroup[] {
    return CATALOG;
  }
}
