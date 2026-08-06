'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { downloadFile, getErrorMessage, isApiClientError, saveBlob } from '@/lib/api';
import {
  attachmentDownloadPath,
  deleteAttachment,
  listAttachments,
  unwrapList,
  uploadAttachment,
  type AttachmentResourceType,
} from '@/lib/endpoints';
import {
  attachmentFileName,
  attachmentKindLabel,
  attachmentSizeBytes,
  attachmentUploadedAt,
  attachmentUploader,
  formatFileSize,
  type Attachment,
} from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { LookupSelect } from '@/components/inventory/pickers';

/** Mirror of the API's MAX_ATTACHMENT_BYTES (20 MiB multer cap). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Mirror of the API's ALLOWED_TYPES whitelist (documents/spreadsheets/photos). */
const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.txt',
  '.csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
];

/**
 * True when the API reports the attachments service as unavailable — the
 * S3_ENABLED=false deployment answers with a service-disabled error, and a
 * 404 means the module is not deployed at all. Both degrade to an
 * informative empty state instead of an error panel.
 */
function attachmentsUnavailable(error: unknown): boolean {
  if (!isApiClientError(error)) return false;
  if (error.status === 404 || error.status === 501 || error.status === 503) return true;
  return [
    'SERVICE_DISABLED',
    'SERVICE_UNAVAILABLE',
    'ATTACHMENTS_DISABLED',
    'STORAGE_DISABLED',
    'S3_DISABLED',
    'NOT_IMPLEMENTED',
  ].includes(error.code);
}

export interface AttachmentsPanelProps {
  resourceType: AttachmentResourceType;
  resourceId: string;
  /**
   * Parent-resource update permissions that unlock upload/delete in addition
   * to the attachment.* catalog entries (contract §4.6 binds writes to the
   * parent's update permission; the server is the authority either way).
   */
  managePermissions?: readonly string[];
  /** `card` (default) wraps in a Card; `bare` renders a plain section for sheets/tabs. */
  variant?: 'card' | 'bare';
  title?: string;
  description?: string;
}

export function AttachmentsPanel({
  resourceType,
  resourceId,
  managePermissions = [],
  variant = 'card',
  title = 'Attachments',
  description = 'Supporting documents and photos for this record.',
}: AttachmentsPanelProps) {
  const queryClient = useQueryClient();
  const { user, can, canAny } = useSession();
  const { toast } = useToast();

  // Route guards: list/download need attachment.view, writes attachment.upload —
  // each PLUS the parent's own permission + branch scope (checked in-service).
  const canView = can(PERMISSIONS.attachment.view);
  const canUpload =
    can(PERMISSIONS.attachment.upload) &&
    (managePermissions.length === 0 || canAny(managePermissions));
  const canArchiveOthers =
    can(PERMISSIONS.attachment.upload) &&
    canAny([PERMISSIONS.attachment.archive, ...managePermissions]);
  const canArchiveOwn = can(PERMISSIONS.attachment.upload);

  const [documentTypeId, setDocumentTypeId] = React.useState('');
  const [dragOver, setDragOver] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Attachment | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const queryKey = ['attachments', resourceType, resourceId];
  const listQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => listAttachments(resourceType, resourceId, signal),
    enabled: canView,
    retry: (failureCount, error) => !attachmentsUnavailable(error) && failureCount < 2,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadAttachment({
        resourceType,
        resourceId,
        file,
        documentTypeId: documentTypeId || undefined,
      }),
    onSuccess: (attachment) => {
      toast({
        title: 'File uploaded',
        description: attachmentFileName(attachment),
        variant: 'success',
      });
      setUploadError(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      if (attachmentsUnavailable(error)) {
        setUploadError(
          'File storage is currently disabled on this server — the upload was not saved.',
        );
        return;
      }
      setUploadError(getErrorMessage(error));
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (attachment: Attachment) => {
      const { blob, filename } = await downloadFile(
        attachmentDownloadPath(attachment.id),
        attachmentFileName(attachment),
      );
      saveBlob(blob, filename);
    },
    onError: (error) => {
      toast({ title: 'Download failed', description: getErrorMessage(error), variant: 'destructive' });
    },
  });

  const acceptFile = (file: File | null) => {
    if (!file || uploadMutation.isPending) return;
    const extension = /\.[^.]+$/.exec(file.name)?.[0]?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setUploadError(
        `File type "${extension || '(none)'}" is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`,
      );
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadError(
        `"${file.name}" is ${formatFileSize(file.size)} — files up to ${formatFileSize(MAX_FILE_BYTES)} are accepted.`,
      );
      return;
    }
    setUploadError(null);
    uploadMutation.mutate(file);
  };

  const attachments = (listQuery.data ? unwrapList(listQuery.data) : []).filter(
    (attachment) => !attachment.archivedAt,
  );

  const disabled = listQuery.isError && attachmentsUnavailable(listQuery.error);

  // Sessions without the attachment catalog permission would only see 403s —
  // render nothing (mounts may additionally gate their tab/card on it).
  if (!canView) return null;

  const body = (
    <div className="space-y-3">
      {canUpload && !disabled ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <LookupSelect
              id={`attachment-kind-${resourceId}`}
              type="document-types"
              value={documentTypeId}
              onChange={setDocumentTypeId}
              placeholder="Document type (optional)"
            />
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload attachment"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                acceptFile(event.dataTransfer.files?.[0] ?? null);
              }}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-2 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
                uploadMutation.isPending && 'pointer-events-none opacity-60',
              )}
            >
              <Upload className="h-4 w-4 text-muted-foreground" aria-hidden />
              {uploadMutation.isPending ? 'Uploading…' : 'Choose or drop a file'}
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_EXTENSIONS.join(',')}
                className="sr-only"
                aria-hidden
                tabIndex={-1}
                onChange={(event) => {
                  acceptFile(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
            </div>
          </div>
          <FormError message={uploadError} />
        </div>
      ) : null}

      {listQuery.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : disabled ? (
        <EmptyState
          icon={Paperclip}
          title="File storage is not enabled"
          description="Attachments are turned off on this server (no S3/MinIO storage configured). Existing records are unaffected — ask an administrator to enable file storage."
          className="py-8"
        />
      ) : listQuery.isError ? (
        <ErrorState error={listQuery.error} onRetry={() => listQuery.refetch()} />
      ) : attachments.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title="No attachments yet"
          description={canUpload ? 'Upload the first supporting document or photo.' : undefined}
          className="py-8"
        />
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead className="hidden md:table-cell">Size</TableHead>
                <TableHead className="hidden lg:table-cell">Uploaded by</TableHead>
                <TableHead className="hidden sm:table-cell">Uploaded</TableHead>
                <TableHead className="w-20 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attachments.map((attachment) => {
                const uploader = attachmentUploader(attachment);
                const isOwn =
                  !!uploader?.id && uploader.id === user.id
                    ? true
                    : attachment.uploadedById === user.id;
                return (
                  <TableRow key={attachment.id}>
                    <TableCell className="max-w-[16rem]">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate text-sm font-medium">
                          {attachmentFileName(attachment)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {attachmentKindLabel(attachment) ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground md:table-cell">
                      {formatFileSize(attachmentSizeBytes(attachment))}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {uploader?.displayName ?? uploader?.email ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                      {formatDateTime(attachmentUploadedAt(attachment))}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Download ${attachmentFileName(attachment)}`}
                          disabled={downloadMutation.isPending}
                          onClick={() => downloadMutation.mutate(attachment)}
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </Button>
                        {canArchiveOthers || (canArchiveOwn && isOwn) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={`Delete ${attachmentFileName(attachment)}`}
                            onClick={() => setDeleteTarget(attachment)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete attachment?"
        description={
          deleteTarget
            ? `"${attachmentFileName(deleteTarget)}" will be archived and removed from this record. The file stays in audit history.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteAttachment(deleteTarget.id);
          toast({ title: 'Attachment deleted', variant: 'success' });
          queryClient.invalidateQueries({ queryKey });
        }}
      />
    </div>
  );

  if (variant === 'bare') {
    return (
      <section aria-label={title} className="space-y-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {body}
      </section>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
