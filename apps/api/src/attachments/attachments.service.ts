import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { hasAnyPermission, PERMISSIONS } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import {
  ATTACHMENT_PARENTS,
  type AttachmentParentConfig,
  type AttachmentParentRow,
} from './attachment-parents';
import { AttachmentStorageService } from './attachment-storage.service';
import type { QueryAttachmentsDto } from './dto/query-attachments.dto';
import type { UploadAttachmentDto } from './dto/upload-attachment.dto';

/** Hard cap enforced by multer as well — kept in one place for messages. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MiB

/**
 * Allowed file types (spec §23 "validate file type and size"): documents,
 * spreadsheets, and photos. Extension AND declared MIME type must both be on
 * the list — mismatches are rejected, executables never pass.
 */
const ALLOWED_TYPES: Record<string, readonly string[]> = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
  '.doc': ['application/msword'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

const ATTACHMENT_SELECT = {
  id: true,
  resourceType: true,
  resourceId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  storageKey: true,
  checksum: true,
  branchId: true,
  archivedAt: true,
  createdAt: true,
  documentType: { select: { id: true, code: true, name: true } },
  uploadedBy: { select: { id: true, displayName: true, email: true } },
} satisfies Prisma.AttachmentSelect;

type AttachmentRow = Prisma.AttachmentGetPayload<{
  select: typeof ATTACHMENT_SELECT;
}>;

/** Public attachment shape — the storage key never leaves the API. */
export interface AttachmentView {
  id: string;
  resourceType: string;
  resourceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  branchId: string | null;
  documentType: { id: string; code: string; name: string } | null;
  uploadedBy: { id: string; displayName: string; email: string };
  createdAt: Date;
}

export interface AttachmentDownload {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  stream: Readable;
}

export interface UploadedFileInput {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * Generic polymorphic attachments (api-outline §4.6, spec §23). Metadata in
 * Postgres, bytes in MinIO/S3; every operation re-authorizes against the
 * PARENT record (its view/update permission + branch scope). Archive is soft
 * (archived_at) — bytes and metadata stay for the audit trail.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  async upload(
    user: AuthUser,
    dto: UploadAttachmentDto,
    file: UploadedFileInput,
    ctx: AuditContext,
  ): Promise<AttachmentView> {
    this.storage.assertEnabled();
    const config = this.parentConfig(dto.resourceType);
    const parent = await this.requireParent(user, config, dto.resourceId);
    this.assertParentPermission(user, config.updatePermissions);

    const extension = this.validateFile(file);
    const documentTypeId = await this.resolveDocumentType(dto.documentTypeId);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    // Safe unique key: never derived from the user-supplied file name beyond
    // its (validated) extension.
    const storageKey = `${config.resourceType}/${parent.id}/${randomUUID()}${extension}`;

    await this.storage.put(storageKey, file.buffer, file.mimeType);
    let row: AttachmentRow;
    try {
      row = await this.prisma.attachment.create({
        data: {
          resourceType: config.resourceType,
          resourceId: parent.id,
          fileName: this.sanitizeFileName(file.originalName),
          mimeType: file.mimeType,
          sizeBytes: file.buffer.length,
          storageKey,
          checksum,
          documentTypeId,
          branchId: parent.branchIds[0] ?? null,
          uploadedById: user.id,
        },
        select: ATTACHMENT_SELECT,
      });
    } catch (error) {
      // Metadata write failed — do not leave orphaned bytes behind.
      await this.storage.deleteQuietly(storageKey);
      throw error;
    }

    await this.audit.log({
      action: 'attachment.uploaded',
      resourceType: 'attachment',
      resourceId: row.id,
      branchId: row.branchId ?? undefined,
      newValues: {
        parentType: config.resourceType,
        parentId: parent.id,
        parentLabel: parent.label,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        checksum,
      },
      ...ctx,
    });
    return this.toView(row);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    user: AuthUser,
    query: QueryAttachmentsDto,
  ): Promise<Paginated<AttachmentView>> {
    const config = this.parentConfig(query.resourceType);
    await this.requireParent(user, config, query.resourceId);
    this.assertParentPermission(user, config.viewPermissions);

    const { page, pageSize, skip, take } = pageArgs(query);
    const where: Prisma.AttachmentWhereInput = {
      resourceType: config.resourceType,
      resourceId: query.resourceId,
      archivedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.attachment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: ATTACHMENT_SELECT,
      }),
      this.prisma.attachment.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.toView(row)),
      page,
      pageSize,
      total,
    );
  }

  /** GET /attachments/:id/download — parent-authorized streamed bytes. */
  async download(user: AuthUser, id: string): Promise<AttachmentDownload> {
    this.storage.assertEnabled();
    const row = await this.requireAttachment(id);
    const config = this.parentConfig(row.resourceType);
    await this.requireParent(user, config, row.resourceId);
    this.assertParentPermission(user, config.viewPermissions);

    const { body } = await this.storage.getStream(row.storageKey);
    return {
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      stream: body,
    };
  }

  // -------------------------------------------------------------------------
  // Archive
  // -------------------------------------------------------------------------

  /**
   * DELETE /attachments/:id — soft archive (bytes and metadata stay; spec §23
   * "archive with audit history"). Allowed for holders of the parent's
   * update-permission, the original uploader, or attachment.archive.
   */
  async archive(user: AuthUser, id: string, ctx: AuditContext): Promise<void> {
    const row = await this.requireAttachment(id);
    const config = this.parentConfig(row.resourceType);
    const parent = await this.requireParent(user, config, row.resourceId);

    const isUploader = row.uploadedBy.id === user.id;
    const mayArchive =
      user.isSuperAdmin ||
      isUploader ||
      hasAnyPermission(user.permissions, [
        ...config.updatePermissions,
        PERMISSIONS.attachment.archive,
      ]);
    if (!mayArchive) {
      throw AppException.forbidden(
        'Only the uploader or someone who can edit the parent record may archive this attachment.',
      );
    }

    await this.prisma.attachment.update({
      where: { id: row.id },
      data: { archivedAt: new Date() },
    });
    await this.audit.log({
      action: 'attachment.archived',
      resourceType: 'attachment',
      resourceId: row.id,
      branchId: row.branchId ?? undefined,
      oldValues: {
        parentType: config.resourceType,
        parentId: parent.id,
        fileName: row.fileName,
      },
      ...ctx,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private parentConfig(resourceType: string): AttachmentParentConfig {
    const config = ATTACHMENT_PARENTS[resourceType];
    if (!config) {
      throw AppException.validation([
        {
          field: 'resourceType',
          message: `Unsupported resource type "${resourceType}".`,
        },
      ]);
    }
    return config;
  }

  /**
   * Fetch the parent record and enforce branch scope. Out-of-scope and
   * nonexistent parents are both 404 — no existence leak.
   */
  private async requireParent(
    user: AuthUser,
    config: AttachmentParentConfig,
    resourceId: string,
  ): Promise<AttachmentParentRow> {
    const delegate = (
      this.prisma as unknown as Record<
        string,
        {
          findUnique(args: {
            where: { id: string };
            select: Record<string, unknown>;
          }): Promise<Record<string, unknown> | null>;
        }
      >
    )[config.delegate];
    const row = await delegate.findUnique({
      where: { id: resourceId },
      select: config.select,
    });
    if (!row) {
      throw AppException.notFound('The parent record was not found.');
    }
    const parent = config.toParentRow(row);
    const inScope =
      parent.branchIds.length === 0 ||
      parent.branchIds.some((branchId) =>
        this.branchScope.canAccess(user, branchId),
      );
    if (!inScope) {
      throw AppException.notFound('The parent record was not found.');
    }
    return parent;
  }

  private assertParentPermission(
    user: AuthUser,
    required: readonly string[],
  ): void {
    if (user.isSuperAdmin || hasAnyPermission(user.permissions, required)) {
      return;
    }
    throw AppException.forbidden();
  }

  private async requireAttachment(id: string): Promise<AttachmentRow> {
    const row = await this.prisma.attachment.findUnique({
      where: { id },
      select: ATTACHMENT_SELECT,
    });
    if (!row || row.archivedAt) {
      throw AppException.notFound('Attachment not found.');
    }
    return row;
  }

  /** Extension + MIME whitelist and size cap; returns the safe extension. */
  private validateFile(file: UploadedFileInput): string {
    if (file.buffer.length === 0) {
      throw AppException.validation([
        { field: 'file', message: 'The uploaded file is empty.' },
      ]);
    }
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) {
      throw AppException.validation([
        {
          field: 'file',
          message: `Files may be at most ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
        },
      ]);
    }
    const extension = extname(file.originalName ?? '').toLowerCase();
    const allowedMimes = ALLOWED_TYPES[extension];
    if (!allowedMimes) {
      throw AppException.validation([
        {
          field: 'file',
          message: `File type "${extension || '(none)'}" is not allowed. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}.`,
        },
      ]);
    }
    if (!allowedMimes.includes(file.mimeType.toLowerCase())) {
      throw AppException.validation([
        {
          field: 'file',
          message: `The declared content type "${file.mimeType}" does not match the ${extension} extension.`,
        },
      ]);
    }
    return extension;
  }

  private async resolveDocumentType(
    documentTypeId: string | undefined,
  ): Promise<string | null> {
    if (!documentTypeId) {
      return null;
    }
    const value = await this.prisma.lookupValue.findUnique({
      where: { id: documentTypeId },
      select: { id: true, category: true, isActive: true },
    });
    if (!value || value.category !== 'DOCUMENT_TYPE' || !value.isActive) {
      throw AppException.validation([
        {
          field: 'documentTypeId',
          message: 'Must reference an active DOCUMENT_TYPE lookup value.',
        },
      ]);
    }
    return value.id;
  }

  /** Keep the display name readable but header/file-system safe. */
  private sanitizeFileName(name: string): string {
    const trimmed = (name ?? 'file').trim().replace(/[/\\]/g, '_');
    const cleaned = trimmed.replace(/[\r\n\t"<>|:*?]/g, '_');
    return cleaned.slice(0, 255) || 'file';
  }

  private toView(row: AttachmentRow): AttachmentView {
    return {
      id: row.id,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      checksum: row.checksum,
      branchId: row.branchId,
      documentType: row.documentType,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt,
    };
  }
}
