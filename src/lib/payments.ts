import type { Payment, PaymentMethod, Transaction } from '@/lib/types';

/**
 * Money helpers for split payments.
 *
 * A wash can be settled with more than one method, so "the payment method of a
 * transaction" is no longer a single value and its full `totalAmount` no longer
 * belongs to one bucket. Every money figure in the app goes through here, so
 * cash, mobile money and corporate totals stay consistent — and so legacy
 * single-payment records keep working without a data migration.
 */

/** Compare money in cents. Float sums of 2dp prices drift, so never use ===. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Every payment line on a transaction, oldest schema included.
 *
 * Returns [] for an 'In Progress' job — nothing has been paid yet — which is
 * what keeps unpaid cars out of the takings.
 */
export function transactionPayments(t: Transaction): Payment[] {
  if (t.payments && t.payments.length > 0) return t.payments;
  return t.payment ? [t.payment] : [];
}

/** How much of this wash was settled with the given method. */
export function amountByMethod(t: Transaction, method: PaymentMethod): number {
  return transactionPayments(t)
    .filter((p) => p.method === method)
    .reduce((acc, p) => acc + p.amount, 0);
}

/** True if any part of this wash was settled with the given method. */
export function usedMethod(t: Transaction, method: PaymentMethod): boolean {
  return transactionPayments(t).some((p) => p.method === method);
}

/** The networks that count as mobile money. */
export const MOBILE_MONEY_METHODS: PaymentMethod[] = ['Mobile Money', 'Airtel Money'];

export function isMobileMoney(method: PaymentMethod): boolean {
  return MOBILE_MONEY_METHODS.includes(method);
}

/** Mobile money portion of a wash, across every network. */
export function amountMobileMoney(t: Transaction): number {
  return transactionPayments(t)
    .filter((p) => isMobileMoney(p.method))
    .reduce((acc, p) => acc + p.amount, 0);
}

/** True if any part of this wash was paid by mobile money on any network. */
export function usedMobileMoney(t: Transaction): boolean {
  return transactionPayments(t).some((p) => isMobileMoney(p.method));
}

/** Sum of a method across many transactions. */
export function sumByMethod(rows: Transaction[], method: PaymentMethod): number {
  return roundMoney(rows.reduce((acc, t) => acc + amountByMethod(t, method), 0));
}

/**
 * The portion of a wash billed to a corporate account — i.e. what is actually
 * owed. This is NOT necessarily totalAmount: a customer can pay half in cash and
 * put the rest on account, and treating the whole wash as outstanding would
 * overstate every company's bill.
 */
export function corporateOutstanding(t: Transaction): number {
  return amountByMethod(t, 'Corporate Account');
}

/** Methods used, for the denormalised `paymentMethods` query field. */
export function methodsUsed(payments: Payment[]): PaymentMethod[] {
  return [...new Set(payments.map((p) => p.method))];
}

/** A short human summary, e.g. "Cash + Mobile Money" or "Cash". */
export function describeMethods(t: Transaction): string {
  const methods = methodsUsed(transactionPayments(t));
  if (methods.length === 0) return '—';
  return methods.join(' + ');
}
