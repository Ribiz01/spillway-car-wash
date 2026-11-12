'use client';

import { useMemo, useState } from 'react';
import { collection, doc, increment, query, setDoc, where, updateDoc } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useUser } from '@/firebase/auth/use-user';
import { useSyncStatus } from '@/firebase/sync-status';
import type { CorporateAccount, PaymentMethod, Service, Transaction, Vehicle, Washer } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';
import {
  PAYMENT_METHODS,
  methodsUsed,
  moneyEquals,
  requiresReference,
  roundMoney,
  transactionPayments,
} from '@/lib/payments';
import { calcPointsEarned, customerIdForPhone, normalisePhone } from '@/lib/loyalty';
import { inUserLocation } from '@/lib/locations';
import type { Payment } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Car, Check, Clock, Loader2, TriangleAlert, CloudOff, Plus, X, Share2, Ban, Send, Trophy, Users } from 'lucide-react';

/** Where automatic WhatsApp delivery of the current receipt has got to. */
type Delivery =
  | { state: 'idle' | 'sending' | 'sent' | 'unavailable' }
  | { state: 'failed'; error: string };

/**
 * One line of a possibly-split payment. Amount is held as a string because it is
 * bound to a text input mid-typing ("12." is not a number yet); it is parsed
 * only when totalling.
 */
interface PaymentLine {
  key: string;
  method: PaymentMethod;
  amount: string;
  reference: string;
  accountId: string;
}

let lineSeq = 0;
function newLine(method: PaymentMethod, amount: number | ''): PaymentLine {
  lineSeq += 1;
  return {
    key: `line-${lineSeq}`,
    method,
    amount: amount === '' ? '' : String(amount),
    reference: '',
    accountId: '',
  };
}

const parseAmount = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Purely presentational tick. A Radix <Checkbox> renders a <button role="checkbox">,
 * and nesting that inside the row's own <button> is invalid HTML that React flags
 * as a hydration error. The row stays a single large tap target — which is what
 * you want on a tablet at the wash bay — and this just draws the state.
 */
function TickBox({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
        on && 'bg-primary text-primary-foreground'
      )}
    >
      {on && <Check className="h-3 w-3" />}
    </span>
  );
}

/** Minutes since check-in, for the "waiting" badge. */
function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function waitLabel(iso: string) {
  const m = minutesSince(iso);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Cars currently on site: checked in, not yet paid for.
 *
 * This is the second half of the attendant flow. Completing a job is where the
 * washers get assigned and the money is taken — the check-in deliberately
 * captured neither, because neither is known when the car pulls in.
 */
export function ActiveJobs() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const { isOnline, isServerReachable } = useSyncStatus();
  const isWorkingOffline = !isOnline || !isServerReachable;

  const [job, setJob] = useState<Transaction | null>(null);
  const [washerIds, setWasherIds] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [lines, setLines] = useState<PaymentLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Set after a successful completion so the receipt can be offered. */
  const [receipt, setReceipt] = useState<Transaction | null>(null);
  /** The job being cancelled, and why. */
  const [cancelling, setCancelling] = useState<Transaction | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [delivery, setDelivery] = useState<Delivery>({ state: 'idle' });
  /** The job whose washers are being set before payment, and the selection so far. */
  const [assigning, setAssigning] = useState<Transaction | null>(null);
  const [assignIds, setAssignIds] = useState<string[]>([]);

  // Equality on `status` alone — no orderBy — so this is served by the automatic
  // single-field index and needs nothing deployed. Sorted client-side below.
  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return query(collection(firestore, 'transactions'), where('status', '==', 'In Progress'));
  }, [firestore, user]);

  const { data: jobs, isLoading, error } = useCollection<Transaction>(jobsQuery);

  const servicesQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'services') : null),
    [firestore]
  );
  const { data: allServices } = useCollection<Service>(servicesQuery);

  const washersQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'washers') : null),
    [firestore]
  );
  const { data: allWashers } = useCollection<Washer>(washersQuery);

  const accountsQuery = useMemoFirebase(
    () =>
      firestore
        ? query(collection(firestore, 'corporateAccounts'), where('active', '==', true))
        : null,
    [firestore]
  );
  const { data: accounts } = useCollection<CorporateAccount>(accountsQuery);

  // New check-ins carry the customer's details on the job itself. Cars checked
  // in before that existed do not, so the vehicle record is read as a fallback
  // for whichever car is in focus. The vehicle document id IS the plate.
  const focusPlate = job?.licensePlate ?? receipt?.licensePlate;
  const focusVehicleRef = useMemoFirebase(
    () => (firestore && focusPlate ? doc(firestore, 'vehicles', focusPlate) : null),
    [firestore, focusPlate]
  );
  const { data: focusVehicle } = useDoc<Vehicle>(focusVehicleRef);

  const receiptPhone = normalisePhone(receipt?.customerPhone ?? focusVehicle?.phoneNumber);

  // Oldest first: the car that has been waiting longest should be dealt with
  // first. An attendant assigned to a branch only sees that branch's cars.
  const waiting = useMemo(
    () =>
      (jobs ?? [])
        .filter((j) => inUserLocation(j, user?.profile))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [jobs, user?.profile]
  );

  const openJob = (j: Transaction) => {
    setJob(j);
    // Start from whoever was assigned before payment. Ids of washers that have
    // since been removed are dropped, so the "at least one" check stays honest.
    setWasherIds(
      (j.assignedWashers ?? [])
        .map((w) => w.id)
        .filter((id) => !allWashers || allWashers.some((w) => w.id === id))
    );
    setServiceIds(j.services.map((s) => s.id));
    // Seed one Cash line for the whole amount: the overwhelmingly common case is
    // a single cash payment, and splitting is opt-in from there.
    setLines([newLine('Cash', j.totalAmount)]);
  };

  // Services can change while the car is on the ramp, so the amount due is
  // recomputed here from live prices rather than trusting the checked-in total.
  const chosenServices = useMemo(() => {
    if (!allServices) return [];
    return allServices.filter((s) => serviceIds.includes(s.id));
  }, [allServices, serviceIds]);

  const amountDue = roundMoney(chosenServices.reduce((acc, s) => acc + s.price, 0));

  const paidTotal = roundMoney(lines.reduce((acc, l) => acc + parseAmount(l.amount), 0));
  const remaining = roundMoney(amountDue - paidTotal);
  const balances = moneyEquals(paidTotal, amountDue);

  // Each line must be individually valid, or the record is unreconcilable later.
  const linesValid =
    lines.length > 0 &&
    lines.every(
      (l) =>
        parseAmount(l.amount) > 0 &&
        (!requiresReference(l.method) || l.reference.trim().length > 0) &&
        (l.method !== 'Corporate Account' || !!l.accountId)
    );

  const canSubmit =
    !!job && washerIds.length > 0 && chosenServices.length > 0 && linesValid && balances;

  const updateLine = (key: string, patch: Partial<PaymentLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  /** Adds a line pre-filled with whatever is still owed. */
  const addLine = () =>
    setLines((prev) => [
      ...prev,
      newLine('Cash', remaining > 0 ? roundMoney(remaining) : ''),
    ]);

  const completeJob = async () => {
    if (!firestore || !user || !job || !canSubmit) return;
    setIsSubmitting(true);

    const assignedWashers = (allWashers ?? [])
      .filter((w) => washerIds.includes(w.id))
      .map((w) => ({ id: w.id, name: w.name }));

    const completedAt = new Date().toISOString();

    // Every value is a concrete string/number/array — Firestore rejects
    // `undefined` synchronously, so optional keys are spread in conditionally.
    const payments: Payment[] = lines.map((l) => {
      const account = accounts?.find((a) => a.id === l.accountId);
      return {
        method: l.method,
        amount: roundMoney(parseAmount(l.amount)),
        reference: l.reference.trim(),
        ...(l.method === 'Corporate Account' && account
          ? { corporateAccountId: account.id, corporateAccountName: account.name }
          : {}),
      };
    });

    // Any portion left on account means the wash is not fully settled, even if
    // the customer handed over cash for the rest.
    const corporateLine = payments.find((p) => p.method === 'Corporate Account');

    // Loyalty is earned on money actually handed over; the on-account portion
    // earns nothing. The customer is keyed by phone number, so no lookup is
    // needed and this still works with the tablet offline.
    const customerPhone = job.customerPhone ?? focusVehicle?.phoneNumber ?? '';
    const customerName = job.customerName ?? focusVehicle?.ownerName ?? '';
    const consent = job.whatsappReceiptConsent ?? focusVehicle?.whatsappReceiptConsent === true;
    const customerId = customerIdForPhone(customerPhone);
    const paid = roundMoney(
      payments.filter((p) => p.method !== 'Corporate Account').reduce((acc, p) => acc + p.amount, 0)
    );
    const pointsEarned = customerId ? calcPointsEarned(paid) : 0;

    const update = {
      services: chosenServices.map((s) => ({ id: s.id, name: s.name, price: s.price })),
      totalAmount: amountDue,
      assignedWashers,
      payments,
      paymentMethods: methodsUsed(payments),
      status: corporateLine ? 'Pending Payment' : 'Completed',
      completedAt,
      completedByUid: user.uid,
      completedByName: user.profile?.name || user.email || 'Unknown',
      washDurationSeconds: Math.max(
        0,
        Math.floor((Date.parse(completedAt) - Date.parse(job.timestamp)) / 1000)
      ),
      whatsappReceiptConsent: consent,
      ...(customerPhone ? { customerPhone } : {}),
      ...(customerName ? { customerName } : {}),
      // Recorded on the wash so that voiding it can take back exactly these points.
      ...(customerId ? { customerId, loyaltyPointsEarned: pointsEarned } : {}),
      // Kept at the top level too so the corporate screens can group and label
      // without walking every payment line.
      ...(corporateLine
        ? {
            corporateAccountId: corporateLine.corporateAccountId,
            corporateAccountName: corporateLine.corporateAccountName,
          }
        : {}),
    };

    try {
      // Awaited, unlike check-in: taking money is the moment the attendant needs
      // to know it stuck. Offline this resolves from cache and still queues.
      await updateDoc(doc(firestore, 'transactions', job.id), update);
      toast({
        title: `${job.licensePlate} completed`,
        description: `${formatCurrency(amountDue)} settled by ${methodsUsed(payments).join(' + ')}.`,
      });
      if (customerId) {
        // A blind merge with increments: creates the member on a first visit and
        // adds to them on every later one, without reading first. Not awaited —
        // a loyalty hiccup must never hold up the till.
        setDoc(
          doc(firestore, 'customers', customerId),
          {
            phoneNumber: customerId,
            ...(customerName ? { name: customerName } : {}),
            totalPoints: increment(pointsEarned),
            totalVisits: increment(1),
            totalSpend: increment(paid),
            lastVisitAt: completedAt,
            lastPlate: job.licensePlate,
          },
          { merge: true }
        ).catch(() => {
          toast({
            title: 'Loyalty points not saved',
            description: 'The payment was recorded. Tell an admin so the points can be added.',
            variant: 'destructive',
          });
        });
      }

      // Hand straight to the receipt: the customer is still standing there, and
      // this is the only moment they can be given one.
      const completed = { ...job, ...update } as Transaction;
      setReceipt(completed);
      setJob(null);
      setDelivery({ state: 'idle' });
      if (consent && customerId && !isWorkingOffline) void sendReceipt(completed);
    } catch (e: any) {
      toast({
        title: 'Could not complete this wash',
        description: e?.message || 'Nothing was changed. Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Saves who is washing a car that is still on site. No money is involved. */
  const saveWashers = async () => {
    if (!firestore || !assigning) return;
    setIsSubmitting(true);
    const assignedWashers = (allWashers ?? [])
      .filter((w) => assignIds.includes(w.id))
      .map((w) => ({ id: w.id, name: w.name }));
    try {
      await updateDoc(doc(firestore, 'transactions', assigning.id), { assignedWashers });
      toast({
        title: `${assigning.licensePlate} assigned`,
        description: assignedWashers.length
          ? assignedWashers.map((w) => w.name).join(', ')
          : 'No washers assigned.',
      });
      setAssigning(null);
    } catch (e: any) {
      toast({
        title: 'Could not assign washers',
        description: e?.message || 'Nothing was changed. Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Asks the server to deliver the receipt over the WhatsApp Cloud API. The
   * server re-reads the wash and checks consent itself; this only reports back.
   */
  const sendReceipt = async (t: Transaction) => {
    if (!firestore || !user) return;
    setDelivery({ state: 'sending' });
    let outcome: Delivery;
    try {
      const response = await fetch('/api/send-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({ transactionId: t.id }),
      });
      if (response.status === 503) {
        // Automatic delivery simply is not set up on this deployment. That is a
        // configuration state, not a failed receipt, so nothing is recorded and
        // the attendant is pointed at the manual button instead.
        setDelivery({ state: 'unavailable' });
        return;
      }
      const result = await response.json().catch(() => ({}));
      outcome = response.ok
        ? { state: 'sent' }
        : { state: 'failed', error: result.error || 'Receipt delivery failed.' };
    } catch {
      outcome = { state: 'failed', error: 'No connection to the server. Try again when back online.' };
    }
    setDelivery(outcome);
    updateDoc(doc(firestore, 'transactions', t.id), {
      receiptDeliveryStatus: outcome.state === 'sent' ? 'Sent' : 'Failed',
      receiptDeliveryError: outcome.state === 'failed' ? outcome.error : '',
    }).catch(() => {
      // The receipt itself went (or did not); failing to log that is not worth
      // interrupting the attendant for.
    });
  };

  const confirmCancel = async () => {
    if (!firestore || !user || !cancelling || cancelReason.trim().length === 0) return;
    setIsSubmitting(true);
    try {
      // Kept as a record rather than deleted: a car that was checked in and then
      // vanished is exactly the thing a manager needs to be able to look up.
      await updateDoc(doc(firestore, 'transactions', cancelling.id), {
        status: 'Cancelled',
        cancelledAt: new Date().toISOString(),
        cancelledByUid: user.uid,
        cancelledByName: user.profile?.name || user.email || 'Unknown',
        reversalReason: cancelReason.trim(),
      });
      toast({
        title: `${cancelling.licensePlate} cancelled`,
        description: 'Removed from Cars On Site. No money was recorded.',
      });
      setCancelling(null);
      setCancelReason('');
    } catch (e: any) {
      toast({
        title: 'Could not cancel',
        description: e?.message || 'Nothing was changed. Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const shareReceipt = () => {
    if (!receipt) return;
    const phone = receiptPhone;
    if (!phone) return;

    const services = receipt.services.map(
      (s) => `- ${s.name}: ${formatCurrency(s.price)}`
    );
    const payments = transactionPayments(receipt).map(
      (p) =>
        `- ${p.method}: ${formatCurrency(p.amount)}` +
        (p.reference ? ` (${p.reference})` : '')
    );

    // Built as lines and joined, rather than one string full of escapes — the
    // WhatsApp body is easier to read and reorder this way.
    const lines = [
      '*Spillway Car Wash & Grill*',
      '---------------------------',
      '*OFFICIAL RECEIPT*',
      '',
      `Receipt ID: ${receipt.id}`,
      `Date: ${new Date(receipt.completedAt ?? receipt.timestamp).toLocaleString()}`,
      `License Plate: ${receipt.licensePlate}`,
      ...([receipt.vehicleMake, receipt.vehicleModel].some(Boolean)
        ? [`Vehicle: ${[receipt.vehicleMake, receipt.vehicleModel].filter(Boolean).join(' ')}`]
        : []),
      '',
      '*Services:*',
      ...services,
      '',
      '*Payment:*',
      ...payments,
      '',
      '---------------------------',
      `*TOTAL: ${formatCurrency(receipt.totalAmount)}*`,
      `Status: ${receipt.status}`,
      '---------------------------',
      ...(receipt.loyaltyPointsEarned ? ['', `You earned ${receipt.loyaltyPointsEarned} loyalty points today.`] : []),
      '',
      'Thank you for your business!',
    ];

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank');
    toast({
      title: 'Opening WhatsApp',
      description: 'Press Send in WhatsApp to deliver the receipt.',
    });
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Cars on site could not be loaded</AlertTitle>
        <AlertDescription className="text-xs">
          Nothing is shown rather than an empty list, which would look like an empty
          forecourt. You can still check cars in below.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Cars On Site</CardTitle>
              <CardDescription>
                Checked in and being washed. Take payment here when the work is done.
              </CardDescription>
            </div>
            <Badge variant={waiting.length > 0 ? 'default' : 'secondary'}>
              {waiting.length} waiting
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {waiting.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No cars on site. Check one in below when it arrives.
            </p>
          ) : (
            <div className="space-y-2">
              {waiting.map((j) => (
                <div
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Car className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-semibold">{j.licensePlate}</span>
                      <Badge variant="outline" className="gap-1 text-xs font-normal">
                        <Clock className="h-3 w-3" />
                        {waitLabel(j.timestamp)}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {[j.vehicleMake, j.vehicleModel].filter(Boolean).join(' ')}
                      {j.vehicleMake || j.vehicleModel ? ' · ' : ''}
                      {j.services.map((s) => s.name).join(', ')}
                      {j.bayNumber ? ` · bay ${j.bayNumber}` : ''}
                      {j.userName ? ` · in by ${j.userName}` : ''}
                    </p>
                    <p className="mt-0.5 truncate text-xs">
                      {j.assignedWashers?.length ? (
                        <span className="text-muted-foreground">
                          Washing: {j.assignedWashers.map((w) => w.name).join(', ')}
                        </span>
                      ) : (
                        <span className="text-amber-700">No washer assigned yet</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium tabular-nums">
                      {formatCurrency(j.totalAmount)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAssigning(j);
                        setAssignIds((j.assignedWashers ?? []).map((w) => w.id));
                      }}
                    >
                      <Users className="mr-1.5 h-4 w-4" />
                      {j.assignedWashers?.length ? 'Washers' : 'Assign'}
                    </Button>
                    <Button size="sm" onClick={() => openJob(j)}>
                      <Check className="mr-1.5 h-4 w-4" /> Complete
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setCancelling(j);
                        setCancelReason('');
                      }}
                      aria-label={`Cancel ${j.licensePlate}`}
                      title="Car left without being washed"
                    >
                      <Ban className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!job} onOpenChange={(open) => !open && setJob(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Complete {job?.licensePlate}</DialogTitle>
            <DialogDescription>
              Confirm who washed it and the work done, then take payment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>Who washed it? (points are split equally)</Label>
              <div className="grid grid-cols-2 gap-2">
                {allWashers?.map((w) => {
                  const on = washerIds.includes(w.id);
                  return (
                    <button
                      type="button"
                      key={w.id}
                      aria-pressed={on}
                      onClick={() =>
                        setWasherIds((prev) =>
                          on ? prev.filter((id) => id !== w.id) : [...prev, w.id]
                        )
                      }
                      className={`flex items-center gap-2 rounded-md border p-2.5 text-left text-sm transition-colors hover:border-primary ${
                        on ? 'border-primary border-2' : ''
                      }`}
                    >
                      <TickBox on={on} />
                      <span className="truncate">{w.name}</span>
                    </button>
                  );
                })}
              </div>
              {allWashers?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No washers set up — ask an admin to add them.
                </p>
              )}
              {washerIds.length === 0 && (
                <p className="text-xs text-destructive">Select at least one washer.</p>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Work done</Label>
              <div className="space-y-1.5">
                {allServices?.map((s) => {
                  const on = serviceIds.includes(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      aria-pressed={on}
                      onClick={() =>
                        setServiceIds((prev) =>
                          on ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                        )
                      }
                      className={`flex w-full items-center justify-between rounded-md border p-2.5 text-sm transition-colors hover:border-primary ${
                        on ? 'border-primary border-2' : ''
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <TickBox on={on} />
                        {s.name}
                      </span>
                      <span className="font-medium">{formatCurrency(s.price)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted p-3">
              <span className="font-medium">Amount due</span>
              <span className="text-xl font-bold tabular-nums">{formatCurrency(amountDue)}</span>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Payment</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addLine}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Split payment
                </Button>
              </div>

              <div className="space-y-3">
                {lines.map((line, index) => (
                  <div key={line.key} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Select
                        value={line.method}
                        onValueChange={(v) =>
                          updateLine(line.key, {
                            method: v as PaymentMethod,
                            // Clear fields that no longer apply, so a stale
                            // reference cannot ride along on a cash line.
                            reference: '',
                            accountId: '',
                          })
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((method) => (
                            <SelectItem key={method} value={method}>{method}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="decimal"
                        className="w-28 text-right tabular-nums"
                        placeholder="0.00"
                        value={line.amount}
                        onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                      />
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => removeLine(line.key)}
                          aria-label={`Remove payment line ${index + 1}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {(requiresReference(line.method) || line.method === 'Other') && (
                      <div className="space-y-1">
                        <Input
                          placeholder={
                            line.method === 'Other'
                              ? 'What was it? e.g. voucher, card (optional)'
                              : `${line.method} reference, e.g. ${line.method === 'Bank Transfer' ? 'FT-12345' : 'MM-12345'}`
                          }
                          value={line.reference}
                          onChange={(e) => updateLine(line.key, { reference: e.target.value })}
                        />
                        {requiresReference(line.method) && line.reference.trim().length === 0 && (
                          <p className="text-xs text-destructive">
                            Required — cash-up reconciles against it.
                          </p>
                        )}
                      </div>
                    )}

                    {line.method === 'Corporate Account' && (
                      <div className="space-y-1">
                        <Select
                          value={line.accountId}
                          onValueChange={(v) => updateLine(line.key, { accountId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select the company" />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts?.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {accounts && accounts.length === 0
                            ? 'No corporate accounts set up yet — ask an admin to add one.'
                            : 'This portion stays unpaid until the company settles.'}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* The wash cannot be completed until the lines add up exactly —
                  a mismatch here becomes an unexplainable drawer variance. */}
              <div
                className={cn(
                  'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
                  balances
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700'
                    : 'border-destructive/30 bg-destructive/5 text-destructive'
                )}
              >
                <span>
                  {balances
                    ? 'Payment balances'
                    : remaining > 0
                      ? `${formatCurrency(remaining)} still to allocate`
                      : `${formatCurrency(Math.abs(remaining))} over the amount due`}
                </span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(paidTotal)} / {formatCurrency(amountDue)}
                </span>
              </div>
            </div>

            {isWorkingOffline && (
              <Alert className="border-amber-500/40 bg-amber-500/5">
                <CloudOff className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-xs text-amber-700/90">
                  Saved on this tablet and uploaded automatically when the connection
                  returns.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setJob(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={completeJob} disabled={!canSubmit || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Take {formatCurrency(amountDue)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign washers to a car before it is paid for. */}
      <Dialog open={!!assigning} onOpenChange={(open) => !open && setAssigning(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Who is washing {assigning?.licensePlate}?</DialogTitle>
            <DialogDescription>
              Pick everyone working on this car. You can change it again any time before
              payment; points are split equally between them.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            {allWashers?.map((w) => {
              const on = assignIds.includes(w.id);
              return (
                <button
                  type="button"
                  key={w.id}
                  aria-pressed={on}
                  onClick={() =>
                    setAssignIds((prev) => (on ? prev.filter((id) => id !== w.id) : [...prev, w.id]))
                  }
                  className={`flex items-center gap-2 rounded-md border p-2.5 text-left text-sm transition-colors hover:border-primary ${
                    on ? 'border-primary border-2' : ''
                  }`}
                >
                  <TickBox on={on} />
                  <span className="truncate">{w.name}</span>
                </button>
              );
            })}
          </div>
          {allWashers?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No washers set up — ask an admin to add them.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={saveWashers} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel a car that never got washed. */}
      <Dialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {cancelling?.licensePlate}?</DialogTitle>
            <DialogDescription>
              Use this when a car leaves without being washed, or the check-in was a
              mistake. No money is recorded. The record is kept so it can be looked up
              later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              placeholder="e.g. customer left, duplicate check-in, wrong plate"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            {cancelReason.trim().length === 0 && (
              <p className="text-xs text-destructive">
                A reason is required — this is the only record of why the money never
                arrived.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)} disabled={isSubmitting}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancel}
              disabled={isSubmitting || cancelReason.trim().length === 0}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel this car
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt, offered immediately after payment. */}
      <Dialog open={!!receipt} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent">
              <Check className="h-8 w-8 text-accent-foreground" />
            </div>
            <DialogTitle className="text-center">Payment taken</DialogTitle>
            <DialogDescription className="text-center">
              Receipt {receipt?.id}
            </DialogDescription>
          </DialogHeader>

          {receipt && (
            <div className="space-y-3 py-2 text-sm">
              <div className="flex justify-between rounded-md border p-3">
                <span className="text-muted-foreground">License plate</span>
                <span className="font-medium">{receipt.licensePlate}</span>
              </div>

              <div className="space-y-1">
                {receipt.services.map((s) => (
                  <div key={s.id} className="flex justify-between">
                    <span>{s.name}</span>
                    <span>{formatCurrency(s.price)}</span>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="space-y-1">
                {transactionPayments(receipt).map((p, i) => (
                  <div key={i} className="flex justify-between text-muted-foreground">
                    <span>
                      {p.method}
                      {p.reference ? ` · ${p.reference}` : ''}
                      {p.corporateAccountName ? ` · ${p.corporateAccountName}` : ''}
                    </span>
                    <span>{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{formatCurrency(receipt.totalAmount)}</span>
              </div>

              {receipt.status === 'Pending Payment' && (
                <p className="text-xs text-destructive">
                  Part of this wash is on account and is still owed.
                </p>
              )}

              {!!receipt.loyaltyPointsEarned && (
                <div className="flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-400/5 p-3 text-amber-700">
                  <Trophy className="h-4 w-4 shrink-0" />
                  <span>
                    {receipt.customerName ? `${receipt.customerName} earned ` : 'Earned '}
                    <span className="font-semibold">{receipt.loyaltyPointsEarned} loyalty points</span>.
                  </span>
                </div>
              )}

              {delivery.state === 'sending' && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending the receipt on WhatsApp…
                </p>
              )}
              {delivery.state === 'sent' && (
                <p className="flex items-center gap-2 text-xs text-emerald-700">
                  <Check className="h-3.5 w-3.5" /> Receipt delivered on WhatsApp.
                </p>
              )}
              {delivery.state === 'failed' && (
                <p className="text-xs text-destructive">Receipt not delivered: {delivery.error}</p>
              )}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {delivery.state === 'failed' && receipt && (
              <Button className="w-full" variant="outline" onClick={() => void sendReceipt(receipt)}>
                <Send className="mr-2 h-4 w-4" /> Try sending again
              </Button>
            )}
            <Button
              className="w-full"
              variant="outline"
              onClick={shareReceipt}
              disabled={!receiptPhone}
            >
              <Share2 className="mr-2 h-4 w-4" />
              {delivery.state === 'sent' ? 'Open in WhatsApp as well' : 'Send on WhatsApp'}
            </Button>
            {!receiptPhone && (
              <p className="text-center text-xs text-muted-foreground">
                No phone number saved for this vehicle, so it can&apos;t be sent.
              </p>
            )}
            <Button className="w-full" onClick={() => setReceipt(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
