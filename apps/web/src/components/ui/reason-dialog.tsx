'use client';

import * as React from 'react';
import { getErrorMessage } from '@/lib/api';
import { Button } from './button';
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from './dialog';
import { FormError } from './error-state';
import { FormField } from './form-field';
import { Textarea } from './textarea';

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Label of the reason field ("Reason", "Rejection comment", …). */
  reasonLabel?: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Extra content rendered above the reason field (e.g. a condition select). */
  children?: React.ReactNode;
  /** Runs on confirm; the dialog stays open with the error message on failure. */
  onConfirm: (reason: string) => Promise<unknown>;
}

/**
 * Confirmation dialog with a mandatory reason/comment field — spec §25 requires
 * reason capture for cancellations, reversals, rejections, disposal, loss, and
 * damage.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel = 'Reason',
  placeholder,
  confirmLabel = 'Confirm',
  destructive = false,
  children,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fieldId = React.useId();

  React.useEffect(() => {
    if (!open) {
      setReason('');
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(`${reasonLabel} is required.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(trimmed);
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
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <DialogBody className="space-y-3">
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          {children}
          <FormField label={reasonLabel} htmlFor={fieldId} required>
            <Textarea
              id={fieldId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={placeholder}
              rows={3}
              data-autofocus
            />
          </FormField>
          <FormError message={error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={destructive ? 'destructive' : 'default'}
            loading={pending}
            disabled={!reason.trim()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
