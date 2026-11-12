'use client';

import { useMemo, useState } from 'react';
import { addDoc, collection, query, where } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useUser } from '@/firebase/auth/use-user';
import type { Expense, ExpensePaymentSource, Transaction } from '@/lib/types';
import { formatCurrency, todayIso, startOfLocalDayIso, endOfLocalDayIso } from '@/lib/utils';
import { ELECTRONIC_METHODS, roundMoney, totalsByMethod } from '@/lib/payments';
import { isRevenue } from '@/lib/transactions';
import { ALL_LOCATIONS, locationStamp, matchesLocationFilter } from '@/lib/locations';
import { downloadCsv, toCsvSections } from '@/lib/csv';
import { LocationFilter } from '@/components/location-filter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Download, Loader2, TriangleAlert } from 'lucide-react';

const paymentSources: ExpensePaymentSource[] = ['Cash', ...ELECTRONIC_METHODS] as ExpensePaymentSource[];

export function ExpensesBanking() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [locationFilter, setLocationFilter] = useState(ALL_LOCATIONS);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentSource, setPaymentSource] = useState<ExpensePaymentSource>('Cash');
  const [expenseDate, setExpenseDate] = useState(todayIso);
  const [saving, setSaving] = useState(false);

  // Both queries range on a single field only, so they are served by the
  // automatic single-field indexes and need nothing deployed. Branch filtering
  // and ordering happen client-side for the same reason.
  const expensesQuery = useMemoFirebase(() => {
    if (!firestore || !user || !startDate || !endDate) return null;
    return query(
      collection(firestore, 'expenses'),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    );
  }, [firestore, user, startDate, endDate]);
  const { data: expenseDocs, isLoading: expensesLoading, error: expensesError } =
    useCollection<Expense>(expensesQuery);

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !startDate || !endDate) return null;
    return query(
      collection(firestore, 'transactions'),
      where('timestamp', '>=', startOfLocalDayIso(startDate)),
      where('timestamp', '<=', endOfLocalDayIso(endDate))
    );
  }, [firestore, user, startDate, endDate]);
  const { data: transactionDocs, isLoading: transactionsLoading, error: transactionsError } =
    useCollection<Transaction>(transactionsQuery);

  const loadError = expensesError || transactionsError;

  const expenses = useMemo(
    () =>
      (expenseDocs ?? [])
        .filter((e) => matchesLocationFilter(e, locationFilter))
        .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [expenseDocs, locationFilter]
  );

  const expenseTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of expenses) {
      totals[e.paymentSource] = roundMoney((totals[e.paymentSource] ?? 0) + e.amount);
    }
    return totals;
  }, [expenses]);

  // Real sales only, split by the method each PORTION was paid with — a wash
  // paid half cash, half mobile money lands in both rows.
  const received = useMemo(
    () =>
      totalsByMethod(
        (transactionDocs ?? []).filter(isRevenue).filter((t) => matchesLocationFilter(t, locationFilter))
      ),
    [transactionDocs, locationFilter]
  );

  const totalExpenses = roundMoney(Object.values(expenseTotals).reduce((a, b) => a + b, 0));
  const cashForBanking = roundMoney(received.Cash - (expenseTotals.Cash ?? 0));
  const mobileReceived = roundMoney(received['Mobile Money'] + received['Airtel Money']);

  const saveExpense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !user) return;
    const value = roundMoney(Number(amount));
    if (!description.trim() || !Number.isFinite(value) || value <= 0 || !expenseDate) {
      toast({
        title: 'Check expense details',
        description: 'Enter a date, a description and a positive amount.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(firestore, 'expenses'), {
        date: expenseDate,
        description: description.trim(),
        amount: value,
        paymentSource,
        userId: user.uid,
        userName: user.profile?.name || user.email || 'Unknown',
        ...locationStamp(user.profile),
        createdAt: new Date().toISOString(),
      });
      setDescription('');
      setAmount('');
      toast({ title: 'Expense recorded', description: 'The banking totals have been updated.' });
    } catch (e: any) {
      toast({
        title: 'Expense not saved',
        description: e?.message || 'Check your admin access and try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const period = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
    downloadCsv(
      `spillway-banking-${startDate}_${endDate}.csv`,
      toCsvSections([
        {
          title: `SPILLWAY CAR WASH — BANKING ${period}`,
          rows: paymentSources.map((source) => ({
            'Payment Source': source,
            Received: received[source].toFixed(2),
            Expenses: (expenseTotals[source] ?? 0).toFixed(2),
            Available: (received[source] - (expenseTotals[source] ?? 0)).toFixed(2),
          })),
        },
        {
          title: 'EXPENSES',
          rows: expenses.map((e) => ({
            Date: e.date,
            Description: e.description,
            'Payment Source': e.paymentSource,
            Location: e.locationName ?? '',
            'Recorded By': e.userName ?? '',
            Amount: e.amount.toFixed(2),
          })),
        },
      ])
    );
  };

  const metrics = [
    { label: 'Cash available for banking', value: cashForBanking, hint: 'cash received less cash expenses' },
    { label: 'Mobile money received', value: mobileReceived, hint: 'Mobile Money + Airtel Money' },
    { label: 'Bank transfers received', value: received['Bank Transfer'], hint: 'check against the statement' },
    { label: 'Total expenses', value: totalExpenses, hint: `${expenses.length} recorded` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses &amp; Banking</h1>
          <p className="text-muted-foreground">
            Record expenses and see what is available to bank from each payment source.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <LocationFilter value={locationFilter} onChange={setLocationFilter} />
          <div className="space-y-1">
            <Label htmlFor="banking-start" className="text-xs text-muted-foreground">From</Label>
            <Input
              id="banking-start"
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="banking-end" className="text-xs text-muted-foreground">To</Label>
            <Input
              id="banking-end"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={!!loadError}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Could not load this period</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              The figures below are incomplete — do not bank against them. Deploy the
              Firestore rules, then reload:
            </p>
            <code className="block font-mono text-xs">firebase deploy --only firestore:rules</code>
            <p className="text-xs opacity-80">{loadError.message}</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{metric.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {transactionsLoading || expensesLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <p className="text-2xl font-bold tabular-nums">{formatCurrency(metric.value)}</p>
              )}
              <p className="text-xs text-muted-foreground">{metric.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Record Expense</CardTitle>
            <CardDescription>Money paid out of the business — supplies, fuel, wages.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveExpense} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="expense-date">Date</Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={expenseDate}
                  max={todayIso()}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-description">Description</Label>
                <Input
                  id="expense-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Cleaning supplies"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-amount">Amount (ZMW)</Label>
                <Input
                  id="expense-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-source">Paid from</Label>
                <Select value={paymentSource} onValueChange={(v) => setPaymentSource(v as ExpensePaymentSource)}>
                  <SelectTrigger id="expense-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentSources.map((source) => (
                      <SelectItem key={source} value={source}>{source}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Record Expense
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Banking Reconciliation</CardTitle>
            <CardDescription>
              Received from washes, less expenses paid from the same source. Corporate
              account balances are not included until they are settled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {transactionsLoading || expensesLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment source</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentSources.map((source) => {
                    const got = received[source];
                    const spent = expenseTotals[source] ?? 0;
                    return (
                      <TableRow key={source}>
                        <TableCell className="font-medium">{source}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(got)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(spent)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatCurrency(got - spent)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expense History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Paid from</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expensesLoading && (
                <TableRow>
                  <TableCell colSpan={6}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              )}
              {!expensesLoading &&
                expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                    <TableCell className="font-medium">{e.description}</TableCell>
                    <TableCell>{e.paymentSource}</TableCell>
                    <TableCell>{e.locationName || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{e.userName || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(e.amount)}</TableCell>
                  </TableRow>
                ))}
              {!expensesLoading && expenses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                    No expenses for this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
