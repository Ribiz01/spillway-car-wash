'use client';

import { useMemo, useState } from 'react';
import { collection, doc, increment, query, where, orderBy, setDoc, updateDoc, type QueryConstraint } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useUser } from '@/firebase/auth/use-user';
import type { CashUp as CashUpRecord, Transaction } from '@/lib/types';
import { formatCurrency, todayIso, startOfLocalDayIso, endOfLocalDayIso } from '@/lib/utils';
import { amountByMethod, describeMethods, electronicAmount, isElectronic, paidAmount, requiresReference, transactionPayments } from '@/lib/payments';
import { isActive, isRevenue, isReversed, reversalSummary } from '@/lib/transactions';
import { downloadCsv, toCsvSections } from '@/lib/csv';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Banknote, Download, Loader2, Lock, Smartphone, Briefcase, CheckCircle2, TriangleAlert, Ban } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export function CashUp() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [date, setDate] = useState(todayIso());
  const [countedCash, setCountedCash] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [voiding, setVoiding] = useState<Transaction | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !date) return null;
    const constraints: QueryConstraint[] = [
      where('timestamp', '>=', startOfLocalDayIso(date)),
      where('timestamp', '<=', endOfLocalDayIso(date)),
      orderBy('timestamp', 'asc'),
    ];
    return query(collection(firestore, 'transactions'), ...constraints);
  }, [firestore, user, date]);

  const { data: transactions, isLoading, error: transactionsError } = useCollection<Transaction>(transactionsQuery);

  const cashUpRef = useMemoFirebase(
    () => (firestore && date ? doc(firestore, 'cashups', date) : null),
    [firestore, date]
  );
  const { data: existingCashUp, error: cashUpError } = useDoc<CashUpRecord>(cashUpRef);

  // Surfaced in place rather than crashing the app. In practice this means the
  // Firestore rules granting admins the `cashups` / `transactions` collections
  // have not been deployed yet: `firebase deploy --only firestore:rules`.
  const loadError = transactionsError || cashUpError;

  const summary = useMemo(() => {
    const all = transactions ?? [];
    // Cars still on the ramp have no payment and are not takings. They are
    // reported separately so the day is not closed while money is still owed.
    const inProgress = all.filter(isActive);
    // Only real sales. Cancelled and voided records are deliberately excluded
    // from every figure below, but kept in `reversed` for the audit list.
    const rows = all.filter(isRevenue);
    const reversed = all.filter(isReversed);

    // With split payments a single wash can contribute to several buckets, so
    // these sum PORTIONS rather than counting whole transactions. Cash + MoMo +
    // corporate therefore still reconciles exactly to the day's total.
    const cashTotal = rows.reduce((acc, t) => acc + amountByMethod(t, 'Cash'), 0);
    // "momo" throughout this screen now means every electronic method — Mobile
    // Money, Airtel Money, bank transfers and Other. None of it is in the drawer
    // and all of it is checked against a statement, so it is one bucket here;
    // Banking & Expenses breaks it down per method.
    const momoTotal = rows.reduce((acc, t) => acc + electronicAmount(t), 0);
    const corporateTotal = rows.reduce(
      (acc, t) => acc + amountByMethod(t, 'Corporate Account'),
      0
    );

    // Washes with any electronic portion — these are ticked off a statement.
    const momoRows = rows.filter((t) => electronicAmount(t) > 0);

    // Per-attendant breakdown — this is who you hold accountable for the float.
    // Keyed on whoever TOOK THE PAYMENT, not whoever checked the car in: a car
    // can be checked in on one shift and paid for on the next, and the cash sits
    // with the person who accepted it. Older rows fall back to userId.
    const byAttendant = new Map<string, { name: string; cash: number; momo: number; corporate: number; count: number }>();
    for (const t of rows) {
      const key = t.completedByUid ?? t.userId;
      if (!byAttendant.has(key)) {
        byAttendant.set(key, {
          name: t.completedByName ?? t.userName ?? key,
          cash: 0,
          momo: 0,
          corporate: 0,
          count: 0,
        });
      }
      const entry = byAttendant.get(key)!;
      entry.count += 1;
      entry.cash += amountByMethod(t, 'Cash');
      entry.momo += electronicAmount(t);
      entry.corporate += amountByMethod(t, 'Corporate Account');
    }

    // Service mix, useful for spotting an attendant under-ringing premium washes.
    const byService = new Map<string, { count: number; revenue: number }>();
    for (const t of rows) {
      for (const s of t.services) {
        const entry = byService.get(s.name) ?? { count: 0, revenue: 0 };
        entry.count += 1;
        entry.revenue += s.price;
        byService.set(s.name, entry);
      }
    }

    return {
      rows,
      cashTotal,
      momoTotal,
      corporateTotal,
      bankable: cashTotal + momoTotal,
      count: rows.length,
      inProgress,
      inProgressTotal: inProgress.reduce((acc, t) => acc + t.totalAmount, 0),
      reversed,
      momoRows,
      attendants: [...byAttendant.values()].sort((a, b) => b.cash - a.cash),
      services: [...byService.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  }, [transactions]);

  const counted = parseFloat(countedCash);
  const hasCount = countedCash !== '' && !Number.isNaN(counted);
  const variance = hasCount ? counted - summary.cashTotal : 0;

  const voidSale = async () => {
    if (!firestore || !user || !voiding || voidReason.trim().length === 0) return;
    setIsVoiding(true);
    try {
      // Reversed, never deleted or edited. The original amounts stay on the
      // record so the correction is auditable; the status is what removes it
      // from every total.
      await updateDoc(doc(firestore, 'transactions', voiding.id), {
        status: 'Voided',
        voidedAt: new Date().toISOString(),
        voidedByUid: user.uid,
        voidedByName: user.profile?.name || user.email || 'Unknown',
        reversalReason: voidReason.trim(),
      });
      if (voiding.customerId) {
        // The sale no longer happened, so neither did the visit or the points.
        // Exactly what completion credited is taken back.
        setDoc(
          doc(firestore, 'customers', voiding.customerId),
          {
            totalPoints: increment(-(voiding.loyaltyPointsEarned ?? 0)),
            totalVisits: increment(-1),
            totalSpend: increment(-paidAmount(voiding)),
          },
          { merge: true }
        ).catch(() => {
          toast({
            title: 'Loyalty points not reversed',
            description: `The wash was voided, but ${voiding.customerName ?? 'the customer'} kept the points for it.`,
            variant: 'destructive',
          });
        });
      }
      toast({
        title: `${voiding.licensePlate} voided`,
        description: 'Removed from today’s takings. Re-record the wash if it needs correcting.',
      });
      setVoiding(null);
      setVoidReason('');
    } catch (e: any) {
      toast({
        title: 'Could not void this wash',
        description: e?.message || 'Nothing was changed.',
        variant: 'destructive',
      });
    } finally {
      setIsVoiding(false);
    }
  };

  const exportCsv = () => {
    const sections = [
      {
        title: `SPILLWAY CAR WASH — CASH UP ${date}`,
        rows: [
          { Item: 'Expected Cash', Amount: summary.cashTotal.toFixed(2) },
          { Item: 'Counted Cash', Amount: hasCount ? counted.toFixed(2) : 'not counted' },
          { Item: 'Variance', Amount: hasCount ? variance.toFixed(2) : '—' },
          { Item: 'Mobile Money & Transfers', Amount: summary.momoTotal.toFixed(2) },
          { Item: 'Corporate (unpaid)', Amount: summary.corporateTotal.toFixed(2) },
          { Item: 'Total Banked', Amount: summary.bankable.toFixed(2) },
          { Item: 'Vehicles Washed', Amount: String(summary.count) },
        ],
      },
      {
        title: 'BY ATTENDANT',
        rows: summary.attendants.map((a) => ({
          Attendant: a.name,
          Washes: a.count,
          Cash: a.cash.toFixed(2),
          'Mobile Money & Transfers': a.momo.toFixed(2),
          Corporate: a.corporate.toFixed(2),
        })),
      },
      {
        title: 'MOBILE MONEY & TRANSFER REFERENCES',
        rows: summary.momoRows.map((t) => ({
          Time: new Date(t.timestamp).toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit' }),
          Plate: t.licensePlate,
          Method: [...new Set(transactionPayments(t).filter((p) => isElectronic(p.method)).map((p) => p.method))].join('; '),
          Reference:
            transactionPayments(t)
              .filter((p) => isElectronic(p.method))
              .map((p) => p.reference || (requiresReference(p.method) ? 'MISSING' : '—'))
              .join('; ') || 'MISSING',
          Amount: electronicAmount(t).toFixed(2),
        })),
      },
      {
        title: 'BY SERVICE',
        rows: summary.services.map((s) => ({
          Service: s.name,
          Count: s.count,
          Revenue: s.revenue.toFixed(2),
        })),
      },
      {
        title: 'ALL TRANSACTIONS',
        rows: summary.rows.map((t) => ({
          Time: new Date(t.timestamp).toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit' }),
          'Receipt ID': t.id,
          Plate: t.licensePlate,
          Services: t.services.map((s) => s.name).join('; '),
          Washers: (t.assignedWashers ?? []).map((w) => w.name).join('; '),
          Method: describeMethods(t),
          Cash: amountByMethod(t, 'Cash').toFixed(2),
          'Mobile Money & Transfers': electronicAmount(t).toFixed(2),
          'On Account': amountByMethod(t, 'Corporate Account').toFixed(2),
          Reference: transactionPayments(t).map((p) => p.reference || '').filter(Boolean).join('; '),
          'Billed To': t.corporateAccountName ?? '',
          Status: t.status,
          Attendant: t.userName ?? t.userId,
          Amount: t.totalAmount.toFixed(2),
        })),
      },
    ];

    downloadCsv(`spillway-cashup-${date}.csv`, toCsvSections(sections));
  };

  const closeDay = async () => {
    if (!firestore || !user || !hasCount) return;
    // Never reconcile against figures we know are incomplete: a failed read
    // leaves every total at 0, which would bank a false variance for the day.
    if (loadError) return;
    setIsSaving(true);
    try {
      const record: Omit<CashUpRecord, 'id'> = {
        date,
        expectedCash: summary.cashTotal,
        countedCash: counted,
        variance,
        mobileMoneyTotal: summary.momoTotal,
        corporateTotal: summary.corporateTotal,
        transactionCount: summary.count,
        note: note.trim(),
        closedAt: new Date().toISOString(),
        closedByUid: user.uid,
        closedByName: user.profile?.name || user.email || 'Unknown',
      };
      // Document id is the date, so closing twice overwrites rather than duplicating.
      await setDoc(doc(firestore, 'cashups', date), record);
      toast({
        title: 'Day Closed',
        description: `${date} reconciled with a variance of ${formatCurrency(variance)}.`,
      });
    } catch (error: any) {
      toast({ title: 'Could not close the day', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const missingRefs = summary.momoRows.filter((t) =>
    transactionPayments(t).some((p) => requiresReference(p.method) && !p.reference)
  ).length;

  return (
    <div className="space-y-6">
      {loadError && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Could not load this day&apos;s takings</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              The figures below are incomplete — do not bank against them. Deploy the
              Firestore rules and indexes, then reload:
            </p>
            <code className="block font-mono text-xs">firebase deploy --only firestore</code>
            <p className="text-xs opacity-80">{loadError.message}</p>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Label htmlFor="cashup-date">Business Date</Label>
          <Input
            id="cashup-date"
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
            className="w-[180px]"
          />
        </div>
        <div className="flex items-center gap-2">
          {existingCashUp && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" /> Closed by {existingCashUp.closedByName}
            </Badge>
          )}
          <Button variant="outline" onClick={exportCsv} disabled={summary.count === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Expected Cash</CardTitle>
                <Banknote className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(summary.cashTotal)}</div>
                <p className="text-xs text-muted-foreground">what should be in the drawer</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Mobile Money &amp; Transfers</CardTitle>
                <Smartphone className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(summary.momoTotal)}</div>
                <p className="text-xs text-muted-foreground">
                  {missingRefs > 0 ? `${missingRefs} missing reference` : 'all references captured'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Corporate (unpaid)</CardTitle>
                <Briefcase className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(summary.corporateTotal)}</div>
                <p className="text-xs text-muted-foreground">not part of today&apos;s banking</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Vehicles Washed</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.count}</div>
                <p className="text-xs text-muted-foreground">{formatCurrency(summary.bankable)} collected</p>
              </CardContent>
            </Card>
          </div>

          {summary.inProgress.length > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>
                {summary.inProgress.length} car(s) still on site, worth{' '}
                {formatCurrency(summary.inProgressTotal)}
              </AlertTitle>
              <AlertDescription>
                {summary.inProgress.map((t) => t.licensePlate).join(', ')} — checked in but
                not paid for, so none of that money is in the figures below. Take payment
                on those washes before closing the day, or the drawer will not reconcile.
              </AlertDescription>
            </Alert>
          )}

          {missingRefs > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>{missingRefs} mobile money payment(s) have no reference</AlertTitle>
              <AlertDescription>
                These can&apos;t be matched against the MoMo statement. Check the details below before closing.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Reconcile Cash</CardTitle>
                <CardDescription>Count the drawer and enter the total.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="counted">Counted Cash (ZMW)</Label>
                  <Input
                    id="counted"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="0.00"
                    value={countedCash}
                    onChange={(e) => setCountedCash(e.target.value)}
                  />
                </div>

                <Separator />

                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expected</span>
                  <span>{formatCurrency(summary.cashTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Counted</span>
                  <span>{hasCount ? formatCurrency(counted) : '—'}</span>
                </div>
                <div
                  className={cn(
                    'flex items-center justify-between rounded-md border p-3 font-bold',
                    !hasCount && 'text-muted-foreground',
                    hasCount && Math.abs(variance) < 0.01 && 'border-emerald-500/40 bg-emerald-500/5 text-emerald-600',
                    hasCount && variance < -0.01 && 'border-destructive/40 bg-destructive/5 text-destructive',
                    hasCount && variance > 0.01 && 'border-amber-500/40 bg-amber-500/5 text-amber-600'
                  )}
                >
                  <span>Variance</span>
                  <span>
                    {hasCount ? `${variance > 0 ? '+' : ''}${formatCurrency(variance)}` : '—'}
                  </span>
                </div>
                {hasCount && variance < -0.01 && (
                  <p className="text-xs text-destructive">
                    Short by {formatCurrency(Math.abs(variance))}. Recount before closing.
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="cashup-note">Note</Label>
                  <Textarea
                    id="cashup-note"
                    placeholder="Explain any variance, float taken, etc."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>

                <Button className="w-full" onClick={closeDay} disabled={!hasCount || isSaving || !!loadError}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Lock className="mr-2 h-4 w-4" />
                  {existingCashUp ? 'Re-close Day' : 'Close Day'}
                </Button>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>By Attendant</CardTitle>
                <CardDescription>Who took what. Cash is the column that needs handing over.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Attendant</TableHead>
                      <TableHead className="text-right">Washes</TableHead>
                      <TableHead className="text-right">Cash</TableHead>
                      <TableHead className="text-right">Mobile &amp; Transfers</TableHead>
                      <TableHead className="text-right">Corporate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.attendants.map((a) => (
                      <TableRow key={a.name}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-right">{a.count}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(a.cash)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(a.momo)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(a.corporate)}</TableCell>
                      </TableRow>
                    ))}
                    {summary.attendants.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No washes recorded on {date}.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {summary.momoRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Mobile Money &amp; Transfer References</CardTitle>
                <CardDescription>Tick these off against the MTN / Airtel / Zamtel and bank statements.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Plate</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.momoRows.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          {new Date(t.timestamp).toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="font-medium">{t.licensePlate}</TableCell>
                        <TableCell className="text-sm">
                          {[...new Set(transactionPayments(t).filter((p) => isElectronic(p.method)).map((p) => p.method))].join(', ')}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {transactionPayments(t)
                            .filter((p) => isElectronic(p.method))
                            .map((p) => p.reference)
                            .filter(Boolean)
                            .join('; ') ||
                            (transactionPayments(t).some((p) => requiresReference(p.method)) ? (
                              <Badge variant="destructive">missing</Badge>
                            ) : (
                              '—'
                            ))}
                        </TableCell>
                        {/* The electronic PORTION, not the wash total: a split
                            wash would otherwise overstate what the statement shows. */}
                        <TableCell className="text-right">{formatCurrency(electronicAmount(t))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s Washes</CardTitle>
              <CardDescription>
                Void a wash that was rung up wrongly. The record is kept and excluded
                from every total — re-record the wash to correct it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Taken by</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.rows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        {new Date(t.completedAt ?? t.timestamp).toLocaleTimeString('en-ZM', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell className="font-medium">{t.licensePlate}</TableCell>
                      <TableCell className="text-xs">{describeMethods(t)}</TableCell>
                      <TableCell className="text-xs">
                        {t.completedByName ?? t.userName ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(t.totalAmount)}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            setVoiding(t);
                            setVoidReason('');
                          }}
                          aria-label={`Void ${t.licensePlate}`}
                          title="Void this wash"
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {summary.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No washes paid for on this date.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {summary.reversed.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Cancelled &amp; Voided</CardTitle>
                <CardDescription>
                  Money that was expected and then wasn&apos;t. Excluded from every figure
                  above — shown so it can be explained.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Plate</TableHead>
                      <TableHead>What happened</TableHead>
                      <TableHead className="text-right">Would have been</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.reversed.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          {new Date(t.timestamp).toLocaleTimeString('en-ZM', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </TableCell>
                        <TableCell className="font-medium">{t.licensePlate}</TableCell>
                        <TableCell className="text-xs">{reversalSummary(t)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatCurrency(t.totalAmount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!voiding} onOpenChange={(open) => !open && setVoiding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void {voiding?.licensePlate}?</DialogTitle>
            <DialogDescription>
              This removes {voiding ? formatCurrency(voiding.totalAmount) : ''} from today&apos;s
              takings. The record is kept for audit. If the wash really happened, re-record
              it afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              placeholder="e.g. wrong amount, rung up twice, customer refunded"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
            {voidReason.trim().length === 0 && (
              <p className="text-xs text-destructive">
                A reason is required — this is what explains the gap at month end.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)} disabled={isVoiding}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={voidSale}
              disabled={isVoiding || voidReason.trim().length === 0}
            >
              {isVoiding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Void this wash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
