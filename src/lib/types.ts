import { User as FirebaseUser } from "firebase/auth";

export type UserRole = 'Admin' | 'Attendant';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AppUser extends FirebaseUser {
  profile: UserProfile;
}

export interface Vehicle {
  id?: string;
  licensePlate: string;
  type: 'Sedan' | 'SUV' | 'Truck' | 'Minibus';
  ownerName?: string;
  phoneNumber?: string;
  photoDataUri?: string;
}

export interface Service {
  id: string;
  name: string;
  price: number;
}

export type PaymentMethod = 'Cash' | 'Mobile Money' | 'Corporate Account';
/**
 * 'In Progress'    — car checked in, being washed, no money taken yet.
 * 'Pending Payment'— finished and billed to a corporate account, not yet settled.
 * 'Completed'      — finished and paid.
 * 'Cancelled'      — checked in but never washed (drove off, wrong plate).
 * 'Voided'         — a completed sale reversed after the fact.
 *
 * Cancelled and Voided records are kept rather than deleted: they are the audit
 * trail for money that was expected and then wasn't. Both are excluded from
 * every total — use the helpers in lib/transactions rather than comparing here.
 */
export type TransactionStatus =
  | 'In Progress'
  | 'Completed'
  | 'Pending Payment'
  | 'Cancelled'
  | 'Voided';

export interface Payment {
  method: PaymentMethod;
  reference?: string;
  amount: number;
  /** Set on a 'Corporate Account' line — which company owes this portion. */
  corporateAccountId?: string;
  corporateAccountName?: string;
}

export interface Transaction {
  id: string;
  timestamp: string;
  licensePlate: string;
  services: { id: string; name: string; price: number; }[];
  totalAmount: number;
  /**
   * All payment lines for this wash. A single wash can be settled with more than
   * one method — half cash, half mobile money, or a corporate account covering
   * part of it — so this is the authoritative record and its amounts sum to
   * totalAmount.
   *
   * Absent while the job is 'In Progress': no money has been taken yet. Read it
   * through `transactionPayments()` in lib/payments, which also unwraps the
   * legacy single `payment` field below.
   */
  payments?: Payment[];
  /**
   * Legacy single payment, written before split payments existed. Never write
   * this on new records — read via `transactionPayments()`.
   */
  payment?: Payment;
  /**
   * Denormalised list of the methods used, purely so Firestore can query it:
   * `where('paymentMethods','array-contains','Corporate Account')`. An
   * array-contains on a single field uses the automatic index, so this needs no
   * composite index deployed.
   */
  paymentMethods?: PaymentMethod[];
  /** Attendant who checked the car in. */
  userId: string;
  /** Attendant display name, denormalised so cash-up reports need no join. */
  userName?: string;
  washerId?: string; // Legacy
  washerName?: string; // Legacy
  /** Assigned at completion — who actually washed the car. */
  assignedWashers?: { id: string; name: string }[];
  status: TransactionStatus;

  // --- Completion ---
  /** When the wash was finished and payment taken. */
  completedAt?: string;
  /**
   * Who took the payment. This is the person holding the cash, which is not
   * necessarily whoever checked the car in — shifts change mid-wash — so the
   * drawer is reconciled against this, falling back to userId on older rows.
   */
  completedByUid?: string;
  completedByName?: string;

  // --- Reversals ---
  /** Set when a checked-in car left without being washed. */
  cancelledAt?: string;
  cancelledByUid?: string;
  cancelledByName?: string;
  /** Set when a completed sale was reversed. */
  voidedAt?: string;
  voidedByUid?: string;
  voidedByName?: string;
  /** Why it was cancelled or voided. Required by the UI — never blank in practice. */
  reversalReason?: string;

  // --- Corporate billing ---
  /** Mirrors the corporate payment line, so corporate screens need no join. */
  corporateAccountId?: string;
  corporateAccountName?: string;
  /** Set once this wash has been paid off as part of a settlement. */
  settlementId?: string;
  settledAt?: string;
}

export interface Washer {
  id: string;
  name: string;
}

/** A company billed on account, e.g. a fleet customer. */
export interface CorporateAccount {
  id: string;
  name: string;
  contactName?: string;
  phoneNumber?: string;
  email?: string;
  /** Optional soft limit in ZMW. 0 or undefined means no limit. */
  creditLimit?: number;
  active: boolean;
  createdAt: string;
}

export type SettlementMethod = 'Cash' | 'Mobile Money' | 'Bank Transfer' | 'Cheque';

/** A payment received against one or more outstanding corporate washes. */
export interface Settlement {
  id: string;
  corporateAccountId: string;
  corporateAccountName: string;
  transactionIds: string[];
  amount: number;
  method: SettlementMethod;
  reference?: string;
  note?: string;
  settledAt: string;
  settledByUid: string;
  settledByName: string;
}

/** An end-of-day reconciliation record. Document id is the date, YYYY-MM-DD. */
export interface CashUp {
  id: string;
  date: string;
  expectedCash: number;
  countedCash: number;
  variance: number;
  mobileMoneyTotal: number;
  corporateTotal: number;
  transactionCount: number;
  note?: string;
  closedAt: string;
  closedByUid: string;
  closedByName: string;
}
