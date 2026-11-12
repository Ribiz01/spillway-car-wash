import type { CustomerTier } from '@/lib/types';

/**
 * Loyalty rules. Kept in one place so the till, the customer list and the
 * reports can never disagree about what a point is worth or where a tier starts.
 */

/** 1 point per whole ZMW actually paid. Money left on account earns nothing until it is real. */
export function calcPointsEarned(amountPaid: number): number {
  return Math.max(0, Math.floor(amountPaid));
}

export function calcTier(points: number): CustomerTier {
  if (points >= 700) return 'Platinum';
  if (points >= 300) return 'Gold';
  if (points >= 100) return 'Silver';
  return 'Bronze';
}

export const TIERS: CustomerTier[] = ['Platinum', 'Gold', 'Silver', 'Bronze'];

export const tierClasses: Record<CustomerTier, string> = {
  Platinum: 'border-purple-400 text-purple-600',
  Gold: 'border-amber-400 text-amber-600',
  Silver: 'border-slate-400 text-slate-600',
  Bronze: 'border-orange-300 text-orange-700',
};

/**
 * A phone number in international form without the plus, e.g. 260977123456.
 *
 * Attendants type the same number as 0977…, 977…, +260 977… and 260977…. They
 * must all land on one customer, and WhatsApp needs the country code, so local
 * Zambian forms are expanded. Returns '' when there are too few digits to be a
 * real number.
 */
export function normalisePhone(raw: string | undefined | null): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 9) return '';
  if (digits.startsWith('0')) return `260${digits.slice(1)}`;
  if (digits.length === 9) return `260${digits}`;
  return digits;
}

/** The `customers` document id for a phone number, or null if it is unusable. */
export function customerIdForPhone(raw: string | undefined | null): string | null {
  const phone = normalisePhone(raw);
  return phone ? phone : null;
}
