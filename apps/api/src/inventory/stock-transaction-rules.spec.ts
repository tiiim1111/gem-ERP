import { StockDocumentStatus, StockTransactionType } from '@prisma/client';
import {
  canTransition,
  directionOf,
  SYSTEM_GENERATED_TYPES,
  transitionError,
  TYPE_CREATE_PERMISSION,
} from './stock-transaction-rules';

/**
 * Pure state-machine tests (docs/status-transitions.md §2): the transition
 * map is the single enforcement point every service action consults.
 */
describe('stock transaction rules', () => {
  describe('directionOf', () => {
    it('maps every non-REVERSAL type to a movement direction', () => {
      for (const type of Object.values(StockTransactionType)) {
        if (type === StockTransactionType.REVERSAL) {
          continue;
        }
        expect(directionOf(type)).toMatch(/^(IN|OUT|MOVE)$/);
      }
    });

    it('receipts flow IN, issues flow OUT, location transfers MOVE', () => {
      expect(directionOf(StockTransactionType.PURCHASE_RECEIPT)).toBe('IN');
      expect(directionOf(StockTransactionType.OPENING_BALANCE)).toBe('IN');
      expect(directionOf(StockTransactionType.ISSUE_TO_EMPLOYEE)).toBe('OUT');
      expect(directionOf(StockTransactionType.DISPOSAL)).toBe('OUT');
      expect(directionOf(StockTransactionType.LOCATION_TRANSFER)).toBe('MOVE');
    });

    it('REVERSAL has no direction — its entries negate the original', () => {
      expect(directionOf(StockTransactionType.REVERSAL)).toBeNull();
    });
  });

  describe('transition map', () => {
    it('allows the happy path Draft → submit → approve → post → reverse', () => {
      expect(canTransition(StockDocumentStatus.DRAFT, 'submit')).toBe(true);
      expect(canTransition(StockDocumentStatus.PENDING_APPROVAL, 'approve')).toBe(true);
      expect(canTransition(StockDocumentStatus.APPROVED, 'post')).toBe(true);
      expect(canTransition(StockDocumentStatus.POSTED, 'reverse')).toBe(true);
    });

    it('only drafts are editable', () => {
      expect(canTransition(StockDocumentStatus.DRAFT, 'update')).toBe(true);
      for (const status of [
        StockDocumentStatus.PENDING_APPROVAL,
        StockDocumentStatus.APPROVED,
        StockDocumentStatus.POSTED,
        StockDocumentStatus.REJECTED,
        StockDocumentStatus.CANCELED,
        StockDocumentStatus.REVERSED,
      ]) {
        expect(canTransition(status, 'update')).toBe(false);
      }
    });

    it('posting is only legal from APPROVED', () => {
      for (const status of Object.values(StockDocumentStatus)) {
        expect(canTransition(status, 'post')).toBe(
          status === StockDocumentStatus.APPROVED,
        );
      }
    });

    it('POSTED documents are immutable except reverse; terminal states allow nothing', () => {
      expect(canTransition(StockDocumentStatus.POSTED, 'update')).toBe(false);
      expect(canTransition(StockDocumentStatus.POSTED, 'cancel')).toBe(false);
      for (const status of [
        StockDocumentStatus.CANCELED,
        StockDocumentStatus.REVERSED,
        StockDocumentStatus.REJECTED,
      ]) {
        for (const event of ['update', 'submit', 'approve', 'reject', 'post', 'cancel', 'reverse'] as const) {
          expect(canTransition(status, event)).toBe(false);
        }
      }
    });

    it('cancel is legal from Draft, Pending Approval, and Approved only', () => {
      expect(canTransition(StockDocumentStatus.DRAFT, 'cancel')).toBe(true);
      expect(canTransition(StockDocumentStatus.PENDING_APPROVAL, 'cancel')).toBe(true);
      expect(canTransition(StockDocumentStatus.APPROVED, 'cancel')).toBe(true);
      expect(canTransition(StockDocumentStatus.POSTED, 'cancel')).toBe(false);
    });

    it('describes the failure for the 409 envelope', () => {
      expect(transitionError(StockDocumentStatus.POSTED, 'update')).toContain('POSTED');
      expect(transitionError(StockDocumentStatus.CANCELED, 'post')).toContain('terminal');
    });
  });

  describe('type metadata', () => {
    it('every type has a create permission', () => {
      for (const type of Object.values(StockTransactionType)) {
        expect(TYPE_CREATE_PERMISSION[type]).toMatch(/^inventory\./);
      }
    });

    it('transfer legs and reversals are system-generated only', () => {
      expect(SYSTEM_GENERATED_TYPES).toContain(
        StockTransactionType.INTER_BRANCH_TRANSFER_OUT,
      );
      expect(SYSTEM_GENERATED_TYPES).toContain(
        StockTransactionType.INTER_BRANCH_TRANSFER_IN,
      );
      expect(SYSTEM_GENERATED_TYPES).toContain(StockTransactionType.REVERSAL);
    });
  });
});
