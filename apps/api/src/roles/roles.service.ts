import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { ALL_PERMISSIONS } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

export interface RoleView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleDetailView extends RoleView {
  permissions: string[];
}

const SORTABLE = { code: 'code', name: 'name', createdAt: 'createdAt' };

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryRolesDto): Promise<Paginated<RoleView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'code',
      direction: 'asc',
    });

    const where: Prisma.RoleWhereInput = {};
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { name: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [rows, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { _count: { select: { rolePermissions: true } } },
      }),
      this.prisma.role.count({ where }),
    ]);

    return paginated(
      rows.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        isActive: role.isActive,
        permissionCount: role._count.rolePermissions,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      })),
      page,
      pageSize,
      total,
    );
  }

  async getById(id: string): Promise<RoleDetailView> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: { select: { code: true } } } },
      },
    });
    if (!role) {
      throw AppException.notFound('Role not found.');
    }
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      permissionCount: role.rolePermissions.length,
      permissions: role.rolePermissions
        .map((entry) => entry.permission.code)
        .sort(),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  async create(dto: CreateRoleDto, ctx: AuditContext): Promise<RoleDetailView> {
    const permissions = [...new Set(dto.permissions ?? [])];
    this.assertPermissionsInCatalog(permissions);

    const existing = await this.prisma.role.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (existing) {
      throw AppException.duplicateCode(
        `A role with code "${dto.code}" already exists.`,
      );
    }

    const permissionIds = await this.resolvePermissionIds(permissions);
    const role = await this.prisma.role.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        isSystem: false,
        rolePermissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
    });

    await this.audit.log({
      action: 'role.created',
      resourceType: 'role',
      resourceId: role.id,
      newValues: {
        code: role.code,
        name: role.name,
        description: role.description,
        permissions,
      },
      ...ctx,
    });
    return this.getById(role.id);
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    ctx: AuditContext,
  ): Promise<RoleDetailView> {
    const role = await this.requireRole(id);
    this.assertNotSystemRole(role);

    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.audit.log({
      action: 'role.updated',
      resourceType: 'role',
      resourceId: id,
      oldValues: {
        name: role.name,
        description: role.description,
        isActive: role.isActive,
      },
      newValues: {
        name: updated.name,
        description: updated.description,
        isActive: updated.isActive,
      },
      ...ctx,
    });
    return this.getById(id);
  }

  /** Replace the role's permission set (system roles are immutable). */
  async setPermissions(
    id: string,
    permissions: string[],
    ctx: AuditContext,
  ): Promise<RoleDetailView> {
    const role = await this.requireRole(id);
    this.assertNotSystemRole(role);

    const uniquePermissions = [...new Set(permissions)];
    this.assertPermissionsInCatalog(uniquePermissions);

    const oldPermissions = (
      await this.prisma.rolePermission.findMany({
        where: { roleId: id },
        include: { permission: { select: { code: true } } },
      })
    )
      .map((entry) => entry.permission.code)
      .sort();

    const permissionIds = await this.resolvePermissionIds(uniquePermissions);
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      ...(permissionIds.length > 0
        ? [
            this.prisma.rolePermission.createMany({
              data: permissionIds.map((permissionId) => ({
                roleId: id,
                permissionId,
              })),
            }),
          ]
        : []),
    ]);

    await this.audit.log({
      action: 'role.permissions_replaced',
      resourceType: 'role',
      resourceId: id,
      oldValues: { permissions: oldPermissions },
      newValues: { permissions: [...uniquePermissions].sort() },
      ...ctx,
    });
    return this.getById(id);
  }

  private async requireRole(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) {
      throw AppException.notFound('Role not found.');
    }
    return role;
  }

  private assertNotSystemRole(role: { isSystem: boolean; code: string }): void {
    if (role.isSystem) {
      throw AppException.forbidden(
        `System role "${role.code}" cannot be modified.`,
      );
    }
  }

  private assertPermissionsInCatalog(permissions: string[]): void {
    const catalog = new Set(ALL_PERMISSIONS);
    const invalid = permissions.filter((permission) => !catalog.has(permission));
    if (invalid.length > 0) {
      throw AppException.validation(
        invalid.map((permission) => ({
          field: 'permissions',
          message: `Unknown permission: ${permission}`,
        })),
      );
    }
  }

  /**
   * Map catalog permission strings to permission-row IDs, self-healing any
   * catalog rows missing from the database (idempotent createMany).
   */
  private async resolvePermissionIds(permissions: string[]): Promise<string[]> {
    if (permissions.length === 0) {
      return [];
    }
    const existing = await this.prisma.permission.findMany({
      where: { code: { in: permissions } },
      select: { id: true, code: true },
    });
    const byCode = new Map(existing.map((row) => [row.code, row.id]));
    const missing = permissions.filter((code) => !byCode.has(code));
    if (missing.length > 0) {
      await this.prisma.permission.createMany({
        data: missing.map((code) => {
          const lastDot = code.lastIndexOf('.');
          return {
            code,
            resource: code.slice(0, lastDot),
            action: code.slice(lastDot + 1),
          };
        }),
        skipDuplicates: true,
      });
      const created = await this.prisma.permission.findMany({
        where: { code: { in: missing } },
        select: { id: true, code: true },
      });
      for (const row of created) {
        byCode.set(row.code, row.id);
      }
    }
    return permissions.map((code) => byCode.get(code)!).filter(Boolean);
  }
}
