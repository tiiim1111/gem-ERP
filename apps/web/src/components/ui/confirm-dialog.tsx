'use client';

import * as React from 'react';
import { getErrorMessage } from '@/lib/api';
import { Button } from './button';
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from './dialog';
import { FormError } from './error-state';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** Runs on confirm; the dialog stays open with an error message on failure. */
  onConfirm: () => Promise<unknown>;
}

/** Confirmation dialog for consequential actions (deactivate, revoke, ...). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div className="text-sm text-muted-foreground">{description}</div>
        <FormError message={error} />
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          onClick={handleConfirm}
          loading={pending}
          data-autofocus
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
