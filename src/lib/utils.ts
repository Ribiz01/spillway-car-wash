import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
  }).format(amount);
}

/**
 * Today's date as YYYY-MM-DD in the *local* timezone.
 *
 * Deliberately not `new Date().toISOString().slice(0, 10)`: that yields the UTC
 * date, so in Zambia (UTC+2) it reports yesterday until 02:00 local, and in
 * negative-offset zones it reports tomorrow through the evening.
 */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * First instant of the given local YYYY-MM-DD day, as a UTC ISO string suitable
 * for comparing against stored transaction timestamps.
 *
 * A bare `new Date('2026-08-24')` parses as UTC midnight, not local midnight —
 * appending a time component is what makes it local.
 */
export function startOfLocalDayIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

/** Last instant of the given local YYYY-MM-DD day, as a UTC ISO string. */
export function endOfLocalDayIso(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}
