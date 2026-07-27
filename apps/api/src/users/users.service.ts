import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** Fields safe to return — password data never leaves the service. */
const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lastActivityAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  userRoles: {
    select: { role: { select: { id: true, code: true, name: true } } },
  },
  branchAccess: {
    select: { branch: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  lastActivityAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  roles: { id: string; code: string; name: string }[];
  branches: { id: string; code: string; name: string }[];
  branchIds: string[];
}

const SORTABLE = {
  email: 'email',
  displayName: 'displayName',
  createdAt: 'createdAt',
  lastLoginAt: 'lastLoginAt',
  isActive: 'isActive',
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryUsersDto): Promise<Paginated<UserView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });

    const where: Prisma.UserWhereInput = {};
    if (query.q) {
      where.OR = [
        { email: { contains: query.q, mode: 'insensitive' } },
        { displayName: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.roleId) {
      where.userRoles = { some: { roleId: query.roleId } };
    }
    if (query.branchId) {
      where.branchAccess = { some: { branchId: query.branchId } };
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy, skip, take, select: USER_SELECT }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows.map(this.toView), page, pageSize, total);
  }

  async getById(id: string): Promise<UserView> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) {
      throw AppException.notFound('User not found.');
    }
    return this.toView(user);
  }

  async create(dto: CreateUserDto, ctx: AuditContext): Promise<UserView> {
    const roleIds = [...new Set(dto.roleIds ?? [])];
    const branchIds = [...new Set(dto.branchIds ?? [])];
    await this.assertRolesExist(roleIds);
    await this.assertBranchesExist(branchIds);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw AppException.duplicateCode(
        'A user with this email already exists.',
      );
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        passwordHash: await hashPassword(dto.password),
        // Admin-set initial password must be replaced at first login.
        mustChangePassword: true,
        userRoles: { create: roleIds.map((roleId) => ({ roleId })) },
        branchAccess: { create: branchIds.map((branchId) => ({ branchId })) },
      },
      select: USER_SELECT,
    });

    await this.audit.log({
      action: 'user.created',
      resourceType: 'user',
      resourceId: user.id,
      newValues: {
        email: user.email,
        displayName: user.displayName,
        roleIds,
        branchIds,
        mustChangePassword: true,
      },
      ...ctx,
    });
    return this.toView(user);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    ctx: AuditContext,
  ): Promise<UserView> {
    const existing = await this.requireUser(id);

    if (dto.email && dto.email !== existing.email) {
      const emailTaken = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });
      if (emailTaken) {
        throw AppException.duplicateCode(
          'A user with this email already exists.',
        );
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.displayName !== undefined
          ? { displayName: dto.displayName }
          : {}),
      },
      select: USER_SELECT,
    });

    await this.audit.log({
      action: 'user.updated',
      resourceType: 'user',
      resourceId: id,
      oldValues: { email: existing.email, displayName: existing.displayName },
      newValues: { email: user.email, displayName: user.displayName },
      ...ctx,
    });
    return this.toView(user);
  }

  async activate(id: string, ctx: AuditContext): Promise<UserView> {
    const existing = await this.requireUser(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive: true, failedLoginCount: 0, lockedUntil: null },
      select: USER_SELECT,
    });
    await this.audit.log({
      action: 'user.activated',
      resourceType: 'user',
      resourceId: id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive: true },
      ...ctx,
    });
    return this.toView(user);
  }

  /** Deactivation revokes every active session — access ends immediately. */
  async deactivate(id: string, ctx: AuditContext): Promise<UserView> {
    const existing = await this.requireUser(id);
    if (ctx.actorUserId === id) {
      throw new AppException(
        409,
        'CANNOT_DEACTIVATE_SELF',
        'You cannot deactivate your own account.',
      );
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: USER_SELECT,
    });
    const revokedSessions = await this.sessions.revokeAllForUser(id);

    await this.audit.log({
      action: 'user.deactivated',
      resourceType: 'user',
      resourceId: id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive: false },
      metadata: { revokedSessions },
      ...ctx,
    });
    return this.toView(user);
  }

  async setRoles(
    id: string,
    roleIds: string[],
    ctx: AuditContext,
  ): Promise<UserView> {
    await this.requireUser(id);
    const uniqueRoleIds = [...new Set(roleIds)];
    const roles = await this.assertRolesExist(uniqueRoleIds);

    const oldAssignments = await this.prisma.userRole.findMany({
      where: { userId: id },
      select: { role: { select: { id: true, code: true } } },
    });

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      ...(uniqueRoleIds.length > 0
        ? [
            this.prisma.userRole.createMany({
              data: uniqueRoleIds.map((roleId) => ({ userId: id, roleId })),
            }),
          ]
        : []),
    ]);

    await this.audit.log({
      action: 'user.roles_replaced',
      resourceType: 'user',
      resourceId: id,
      oldValues: { roles: oldAssignments.map((entry) => entry.role.code) },
      newValues: { roles: roles.map((role) => role.code) },
      ...ctx,
    });
    return this.getById(id);
  }

  async setBranchAccess(
    id: string,
    branchIds: string[],
    ctx: AuditContext,
  ): Promise<UserView> {
    await this.requireUser(id);
    const uniqueBranchIds = [...new Set(branchIds)];
    const branches = await this.assertBranchesExist(uniqueBranchIds);

    const oldAccess = await this.prisma.userBranchAccess.findMany({
      where: { userId: id },
      select: { branch: { select: { id: true, code: true } } },
    });

    await this.prisma.$transaction([
      this.prisma.userBranchAccess.deleteMany({ where: { userId: id } }),
      ...(uniqueBranchIds.length > 0
        ? [
            this.prisma.userBranchAccess.createMany({
              data: uniqueBranchIds.map((branchId) => ({
                userId: id,
                branchId,
              })),
            }),
          ]
        : []),
    ]);

    await this.audit.log({
      action: 'user.branch_access_replaced',
      resourceType: 'user',
      resourceId: id,
      oldValues: { branches: oldAccess.map((entry) => entry.branch.code) },
      newValues: { branches: branches.map((branch) => branch.code) },
      ...ctx,
    });
    return this.getById(id);
  }

  /** Admin reset: new password, forced change at next login, all sessions out. */
  async resetPassword(
    id: string,
    newPassword: string,
    ctx: AuditContext,
  ): Promise<{ message: string }> {
    await this.requireUser(id);

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    const revokedSessions = await this.sessions.revokeAllForUser(id);

    await this.audit.log({
      action: 'user.password_reset',
      resourceType: 'user',
      resourceId: id,
      metadata: { revokedSessions },
      ...ctx,
    });
    return {
      message:
        'Password reset. The user must set a new password at next login.',
    };
  }

  private async requireUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, isActive: true },
    });
    if (!user) {
      throw AppException.notFound('User not found.');
    }
    return user;
  }

  private async assertRolesExist(roleIds: string[]) {
    if (roleIds.length === 0) {
      return [];
    }
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, code: true },
    });
    const found = new Set(roles.map((role) => role.id));
    const missing = roleIds.filter((roleId) => !found.has(roleId));
    if (missing.length > 0) {
      throw AppException.validation(
        missing.map((roleId) => ({
          field: 'roleIds',
          message: `Unknown role ID: ${roleId}`,
        })),
      );
    }
    return roles;
  }

  private async assertBranchesExist(branchIds: string[]) {
    if (branchIds.length === 0) {
      return [];
    }
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds } },
      select: { id: true, code: true },
    });
    const found = new Set(branches.map((branch) => branch.id));
    const missing = branchIds.filter((branchId) => !found.has(branchId));
    if (missing.length > 0) {
      throw AppException.validation(
        missing.map((branchId) => ({
          field: 'branchIds',
          message: `Unknown branch ID: ${branchId}`,
        })),
      );
    }
    return branches;
  }

  private toView = (user: UserRow): UserView => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    lastActivityAt: user.lastActivityAt,
    archivedAt: user.archivedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    roles: user.userRoles.map((entry) => entry.role),
    branches: user.branchAccess.map((entry) => entry.branch),
    branchIds: user.branchAccess.map((entry) => entry.branch.id),
  });
}
