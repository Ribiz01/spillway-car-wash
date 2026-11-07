import {
  arrayUnion,
  doc,
  getDoc,
  getDocFromCache,
  increment,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { calcPointsEarned, calcTier, type Customer, type Transaction, type Vehicle } from '@/lib/types';
import { transactionPayments } from '@/lib/payments';

/**
 * Phone number in international form without "+", e.g. 260977123456.
 * Accepts 0977…, 977…, +260 977…, 260977… and spaces/dashes.
 * Returns '' when it doesn't look like a phone number.
 */
export function normalizePhone(raw?: string | null): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('260') && digits.length >= 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `260${digits.slice(1)}`;
  if (digits.length === 9) return `260${digits}`;
  return digits.length >= 9 ? digits : '';
}

/**
 * The part of a wash that earns points: money actually paid, not the portion
 * left on a corporate account (the company pays that, not the driver).
 */
export function loyaltyAmount(t: Pick<Transaction, 'payments' | 'payment'>): number {
  return transactionPayments(t as Transaction)
    .filter((p) => p.method !== 'Corporate Account')
    .reduce((acc, p) => acc + p.amount, 0);
}

/** Look up a customer by phone. Uses the device cache first so it works offline. */
export async function findCustomer(firestore: Firestore, phone?: string | null): Promise<Customer | null> {
  const id = normalizePhone(phone);
  if (!id) return null;
  const ref = doc(firestore, 'customers', id);
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null;
  } catch {
    try {
      const snap = await getDocFromCache(ref);
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Adds a paid wash to the customer's loyalty record, creating it on the first
 * visit. Uses merge + increment so two tablets completing washes for the same
 * customer can't overwrite each other, and so it queues offline like every
 * other write.
 *
 * Returns the points earned, or 0 when the vehicle has no phone number.
 */
export function recordLoyaltyVisit(
  firestore: Firestore,
  vehicle: Pick<Vehicle, 'ownerName' | 'phoneNumber' | 'licensePlate'> | null | undefined,
  amountPaid: number,
  previous: Customer | null
): number {
  const id = normalizePhone(vehicle?.phoneNumber);
  if (!vehicle || !id) return 0;
  const points = calcPointsEarned(amountPaid);
  const now = new Date().toISOString();
  const newTotal = (previous?.totalPoints ?? 0) + points;

  setDoc(
    doc(firestore, 'customers', id),
    {
      phoneNumber: id,
      name: vehicle.ownerName?.trim() || previous?.name || 'Customer',
      totalPoints: increment(points),
      totalVisits: increment(1),
      totalSpend: increment(Math.round(amountPaid * 100) / 100),
      // Best effort: the list always re-derives the tier from totalPoints, so a
      // stale value here (two tablets at once) never shows the wrong tier.
      tier: calcTier(newTotal),
      plates: arrayUnion(vehicle.licensePlate),
      lastVisitAt: now,
      ...(previous ? {} : { createdAt: now }),
    },
    { merge: true }
  ).catch((e) => console.error('Loyalty update failed', e));

  return points;
}
