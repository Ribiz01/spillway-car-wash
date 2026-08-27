import type { Transaction } from '@/lib/types';

/**
 * Status predicates.
 *
 * There are now five statuses and only two of them represent money. Comparing
 * `status` inline is how a reversed sale quietly leaks back into a total, so
 * every filter in the app goes through these instead.
 */

/**
 * Counts as takings. Both 'Completed' and 'Pending Payment' are real sales —
 * the latter is simply owed by a company rather than already in the drawer.
 */
export function isRevenue(t: Transaction): boolean {
  return t.status === 'Completed' || t.status === 'Pending Payment';
}

/** Checked in, being washed, no money taken yet. */
export function isActive(t: Transaction): boolean {
  return t.status === 'In Progress';
}

/** Cancelled before washing, or voided after the sale. Never counts anywhere. */
export function isReversed(t: Transaction): boolean {
  return t.status === 'Cancelled' || t.status === 'Voided';
}

/** Who reversed it and why, for display in an audit column. */
export function reversalSummary(t: Transaction): string | null {
  if (t.status === 'Cancelled') {
    return `Cancelled by ${t.cancelledByName ?? 'unknown'}${
      t.reversalReason ? ` — ${t.reversalReason}` : ''
    }`;
  }
  if (t.status === 'Voided') {
    return `Voided by ${t.voidedByName ?? 'unknown'}${
      t.reversalReason ? ` — ${t.reversalReason}` : ''
    }`;
  }
  return null;
}
