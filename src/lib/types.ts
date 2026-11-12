import { User as FirebaseUser } from "firebase/auth";

export type UserRole = 'Admin' | 'Attendant';

/** A branch. Washes, expenses and staff can each be tied to one. */
export interface Location {
  id: string;
  name: string;
  address?: string;
  active: boolean;
  createdAt?: string;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  /**
   * Assigned branch. An attendant with one only sees that branch's cars; anyone
   * with none (typically admins) sees every location.
   */
  locationId?: string | null;
  locationName?: string | null;
}

export interface AppUser extends FirebaseUser {
  profile: UserProfile;
}

export interface Vehicle {
  id?: string;
  licensePlate: string;
  make?: string;
  model?: string;
  type: 'Sedan' | 'SUV' | 'Truck' | 'Minibus';
  ownerName?: string;
  phoneNumber?: string;
  /** The customer agreed to be sent receipts on WhatsApp at this number. */
  whatsappReceiptConsent?: boolean;
  photoDataUri?: string;
}

export interface Service {
  id: string;
  name: string;
  price: number;
}

export type PaymentMethod =
  | 'Cash'
  | 'Mobile Money'
  | 'Airtel Money'
  | 'Bank Transfer'
  | 'Other'
  | 'Corporate Account';

export type ReceiptDeliveryStatus = 'Pending' | 'Sent' | 'Failed';
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

  // --- Branch ---
  /** Branch the car was checked in at. Absent on washes from before locations existed. */
  locationId?: string;
  locationName?: string;

  // --- Vehicle & customer, denormalised at check-in so reports need no join ---
  vehicleMake?: string;
  vehicleModel?: string;
  bayNumber?: string;
  customerName?: string;
  customerPhone?: string;
  whatsappReceiptConsent?: boolean;

  // --- Loyalty ---
  /** `customers` document the points below were credited to. */
  customerId?: string;
  /** Points credited at completion — kept so a void can take exactly these back. */
  loyaltyPointsEarned?: number;

  // --- Receipt delivery ---
  receiptDeliveryStatus?: ReceiptDeliveryStatus;
  receiptDeliveryError?: string;

  // --- Completion ---
  /** Check-in to payment, in seconds. */
  washDurationSeconds?: number;
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

export type CustomerTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

/**
 * A loyalty member. The document id is the customer's normalised phone number
 * (see lib/loyalty), which lets a completion credit points with a blind merge
 * write — no lookup first — so it still works with the tablet offline.
 *
 * There is deliberately no stored tier: it is derived from `totalPoints` with
 * `calcTier`, so it can never drift out of step with the points.
 */
export interface Customer {
  id: string;
  name: string;
  phoneNumber: string;
  totalPoints: number;
  totalVisits: number;
  /** Lifetime amount actually paid, in ZMW. Excludes anything left on account. */
  totalSpend: number;
  lastVisitAt?: string;
  lastPlate?: string;
}

/** Where the money for an expense came from. Mirrors the non-corporate payment methods. */
export type ExpensePaymentSource = Exclude<PaymentMethod, 'Corporate Account'>;

export interface Expense {
  id: string;
  /** Local business date, YYYY-MM-DD. */
  date: string;
  description: string;
  /** ZMW. */
  amount: number;
  paymentSource: ExpensePaymentSource;
  userId: string;
  userName?: string;
  locationId?: string;
  locationName?: string;
  createdAt: string;
}
