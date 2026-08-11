'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { getErrorMessage, saveBlob } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/**
 * Fetches a printable document (PDF/HTML) through the authenticated binary
 * helper and opens it in a new tab, falling back to a download when the
 * browser blocks the popup — the batch-labels pattern from Phase 3.5. The
 * server gates each endpoint on the parent resource's view permission and
 * audit-logs every render.
 */
export function PrintDocumentButton({
  fetchDocument,
  fileName,
  label = 'Print / PDF',
}: {
  fetchDocument: () => Promise<{ blob: Blob; contentType: string }>;
  /** Download name (extension adjusted to the returned content type). */
  fileName: string;
  label?: string;
}) {
  const { toast } = useToast();

  const printMutation = useMutation({
    mutationFn: fetchDocument,
    onSuccess: ({ blob, contentType }) => {
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        const extension = contentType.includes('pdf')
          ? 'pdf'
          : contentType.includes('html')
            ? 'html'
            : null;
        const name =
          extension && !fileName.toLowerCase().endsWith(`.${extension}`)
            ? `${fileName}.${extension}`
            : fileName;
        saveBlob(blob, name);
        toast({
          title: 'Document downloaded',
          description: 'Pop-ups are blocked — open the downloaded file to print it.',
        });
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (error) => {
      toast({
        title: 'Could not generate the document',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  return (
    <Button
      variant="outline"
      onClick={() => printMutation.mutate()}
      loading={printMutation.isPending}
    >
      <Printer aria-hidden /> {label}
    </Button>
  );
}
