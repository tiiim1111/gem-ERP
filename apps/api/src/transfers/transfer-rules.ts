import { TransferStatus } from '@prisma/client';

/**
 * Pure state machine for transfer documents (spec §16,
 * docs/status-transitions.md §4). Intra-branch transfers (LOCATION /
 * INTRA_BRANCH) collapse dispatch+receive into one step: `dispatch` posts a
 * LOCATION_TRANSFER movement and lands directly on RECEIVED. Inter-branch
 * transfers go APPROVED → dispatch → IN_TRANSIT → receive → RECEIVED.
 */

export type TransferEvent =
  | 'update'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'dispatch'
  | 'receive'
  | 'cancel';

const TRANSITIONS: Record<TransferStatus, readonly TransferEvent[]> = {
  [TransferStatus.DRAFT]: ['update', 'submit', 'cancel'],
  [TransferStatus.PENDING_APPROVAL]: ['approve', 'reject', 'cancel'],
  [TransferStatus.APPROVED]: ['dispatch', 'cancel'],
  [TransferStatus.REJECTED]: [],
  [TransferStatus.IN_TRANSIT]: ['receive'],
  [TransferStatus.PARTIALLY_RECEIVED]: ['receive'],
  [TransferStatus.RECEIVED]: [],
  [TransferStatus.CANCELED]: [],
};

export function canTransferTransition(
  from: TransferStatus,
  event: TransferEvent,
): boolean {
  return TRANSITIONS[from].includes(event);
}

export function transferTransitionError(
  from: TransferStatus,
  event: TransferEvent,
): string {
  const allowed = TRANSITIONS[from];
  if (from === TransferStatus.IN_TRANSIT && event === 'cancel') {
    return 'Cannot cancel after dispatch — goods are physically moving; receive at destination instead.';
  }
  return `Cannot ${event} a ${from} transfer${
    allowed.length > 0 ? ` (allowed: ${allowed.join(', ')})` : ' (terminal status)'
  }.`;
}
