import { randomBytes } from 'node:crypto';
import { formatSequence } from '../sequences/sequence.util';

/**
 * Asset tag helpers (docs/barcode-strategy.md §2.1, api-outline 1.9).
 *
 * Tag pattern: AST-{BRANCH_CODE}-{CATEGORY_CODE}-{YYYY}-{SEQ6}
 * e.g. AST-SUB-LAP-2026-000123.
 *
 * One sequence counter per (branch, category, year) tuple, keyed
 * "AST-{BRANCH}-{CAT}-{YYYY}" following the sequence_counters key style
 * already used across the schema ("AST-MNL-LAP-2026"). The counter is
 * allocated inside the same transaction that inserts the asset, so a
 * rolled-back registration may burn a number but can never duplicate one.
 */

/** Sequence-counter key for asset tags of a (branch, category, year) tuple. */
export function assetTagSequenceKey(
  branchCode: string,
  categoryCode: string,
  year: number,
): string {
  return `AST-${branchCode.toUpperCase()}-${categoryCode.toUpperCase()}-${year}`;
}

/** Asset tag pattern: AST-{BRANCH}-{CAT}-{YYYY}-{SEQ6}. */
export function formatAssetTag(
  branchCode: string,
  categoryCode: string,
  year: number,
  sequence: number | bigint,
): string {
  return `AST-${branchCode.toUpperCase()}-${categoryCode.toUpperCase()}-${year}-${formatSequence(sequence, 6)}`;
}

/**
 * Registration year in the org display timezone (Asia/Manila, UTC+8, no DST).
 * The tag records provenance, so the year is fixed at registration time.
 */
export function assetTagYear(now: Date = new Date()): number {
  const manila = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return manila.getUTCFullYear();
}

/**
 * Opaque scan token: 32 random bytes, base64url (43 chars, URL-safe, no
 * padding). Never derived from record data; unique index on assets.scan_token.
 */
export function generateScanToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Recognize a scanned QR payload of the form {origin}/scan/{token}. */
export function extractScanToken(raw: string): string | null {
  const match = /\/scan\/([A-Za-z0-9_-]{20,})\/?$/.exec(raw.trim());
  return match ? match[1] : null;
}
