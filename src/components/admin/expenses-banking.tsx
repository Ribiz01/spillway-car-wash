'use client';

import { useMemo, useState } from 'react';
import { collection, deleteDoc, doc, query, setDoc, where } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useUser } from '@/firebase/auth/use-user';
import {
  EXPENSE_CATEGORIES,
  type BankDeposit,
  type Expense,
  type ExpenseCategory,
  type ExpenseSource,
  type Transaction,
} from '@/lib/types';
import { endOfLocalDayIso, formatCurrency, startOfLocalDayIso, todayIso } from '@/lib/utils';
import { amountByMethod, roundMoney } from '@/lib/payments';
import { isRevenue } from '@/lib/transactions';
import { downloadCsv, toCsvSections } from '@/lib/csv';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Download, Landmark, Loader2, Trash2, TriangleAlert } from 'lucide-react';

const SOURCES: ExpenseSource[] = ['Cash', 'Mobile Money', 'Bank'];
const sourceLabel: Record<ExpenseSource, string> = {
  Cash: 'Cash (from the drawer)',
  'Mobile Money': 'Mobile Money',
  Bank: 'Bank account',
};

function firstOfMonthIso() {
  const t = todayIso();
  return `${t.slice(0, 8)}01`;
}

/**
 * Expenses and banking: what was spent, from where, and how much cash is still
 * sitting in the business waiting to be banked.
 */
export function ExpensesBanking() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [startDate, setStartDate] = useState(firstOfMonthIso);
  const [endDate, setEndDate] = useState(todayIso);

  // New expense form
  const [expenseDate, setExpenseDate] = useState(todayIso);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Cleaning supplies');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<ExpenseSource>('Cash');
  const [saving, setSaving] = useState(false);

  // New deposit form
  const [depositDate, setDepositDate] = useState(todayIso);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositRef, setDepositRef] = useState('');
  const [savingDeposit, setSavingDeposit] = useState(false);

  /** Two-tap delete, since the app can't show confirm() dialogs reliably. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Each query ranges over a single field, so none needs a composite index.
  const expensesQuery = useMemoFirebase(
    () =>
      firestore && user
        ? query(collection(firestore, 'expenses'), where('date', '>=', startDate), where('date', '<=', endDate))
        : null,
    [firestore, user, startDate, endDate]
  );
  const { data: expensesRaw, isLoading: expensesLoading, error: expensesError } = useCollection<Expense>(expensesQuery);

  const depositsQuery = useMemoFirebase(
    () =>
      firestore && user
        ? query(collection(firestore, 'bankDeposits'), where('date', '>=', startDate), where('date', '<=', endDate))
        : null,
    [firestore, user, startDate, endDate]
  );
  const { data: depositsRaw, isLoading: depositsLoading } = useCollection<BankDeposit>(depositsQuery);

  const txQuery = useMemoFirebase(
    () =>
      firestore && user
        ? query(
            collection(firestore, 'transactions'),
            where('timestamp', '>=', startOfLocalDayIso(startDate)),
            where('timestamp', '<=', endOfLocalDayIso(endDate))
          )
        : null,
    [firestore, user, startDate, endDate]
  );
  const { data: transactions, isLoading: txLoading } = useCollection<Transaction>(txQuery);

  const expenses = useMemo(
    () => [...(expensesRaw ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [expensesRaw]
  );
  const deposits = useMemo(
    () => [...(depositsRaw ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
    [depositsRaw]
  );

  const totals = useMemo(() => {
    const paid = (transactions ?? []).filter(isRevenue);
    const received = {
      Cash: roundMoney(paid.reduce((a, t) => a + amountByMethod(t, 'Cash'), 0)),
      'Mobile Money': roundMoney(paid.reduce((a, t) => a + amountByMethod(t, 'Mobile Money'), 0)),
      Bank: 0,
    } as Record<ExpenseSource, number>;
    const spent = { Cash: 0, 'Mobile Money': 0, Bank: 0 } as Record<ExpenseSource, number>;
    for (const e of expenses) spent[e.source] = roundMoney(spent[e.source] + e.amount);
    const byCategory = new Map<string, number>();
    for (const e of expenses) byCategory.set(e.category, roundMoney((byCategory.get(e.category) ?? 0) + e.amount));
    const banked = roundMoney(deposits.reduce((a, d) => a + d.amount, 0));
    const totalExpenses = roundMoney(Object.values(spent).reduce((a, b) => a + b, 0));
    const revenue = roundMoney(paid.reduce((a, t) => a + t.totalAmount, 0));
    return {
      received,
      spent,
      banked,
      totalExpenses,
      revenue,
      profit: roundMoney(revenue - totalExpenses),
      cashToBank: roundMoney(received.Cash - spent.Cash - banked),
      byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [transactions, expenses, deposits]);

  const loading = expensesLoading || depositsLoading || txLoading;

  const parseZmw = (v: string) => {
    const n = Math.round(parseFloat(v) * 100) / 100;
    return Number.isFinite(n) ? n : 0;
  };

  const saveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !user) return;
    const value = parseZmw(amount);
    if (!description.trim() || value <= 0) {
      toast({ title: 'Check the expense', description: 'Add a description and an amount above zero.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const ref = doc(collection(firestore, 'expenses'));
    const record: Omit<Expense, 'id'> = {
      date: expenseDate,
      description: description.trim(),
      category,
      amount: value,
      source,
      userId: user.uid,
      userName: user.profile?.name || user.email || 'Unknown',
      createdAt: new Date().toISOString(),
    };
    try {
      await setDoc(ref, record);
      setDescription('');
      setAmount('');
      toast({ title: 'Expense recorded', description: `${formatCurrency(value)} · ${record.category}` });
    } catch {
      toast({ title: 'Expense not saved', description: 'Check your admin access and try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const saveDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !user) return;
    const value = parseZmw(depositAmount);
    if (value <= 0) {
      toast({ title: 'Enter the amount banked', variant: 'destructive' });
      return;
    }
    setSavingDeposit(true);
    try {
      await setDoc(doc(collection(firestore, 'bankDeposits')), {
        date: depositDate,
        amount: value,
        ...(depositRef.trim() ? { reference: depositRef.trim() } : {}),
        userId: user.uid,
        userName: user.profile?.name || user.email || 'Unknown',
        createdAt: new Date().toISOString(),
      });
      setDepositAmount('');
      setDepositRef('');
      toast({ title: 'Deposit recorded', description: `${formatCurrency(value)} banked.` });
    } catch {
      toast({ title: 'Deposit not saved', description: 'Check your admin access and try again.', variant: 'destructive' });
    } finally {
      setSavingDeposit(false);
    }
  };

  const remove = async (path: 'expenses' | 'bankDeposits', id: string) => {
    if (!firestore) return;
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    try {
      await deleteDoc(doc(firestore, path, id));
      toast({ title: 'Deleted' });
    } catch {
      toast({ title: 'Could not delete', variant: 'destructive' });
    }
  };

  const exportCsv = () =>
    downloadCsv(
      `spillway-expenses-${startDate}-to-${endDate}.csv`,
      toCsvSections([
        {
          title: `SUMMARY ${startDate} to ${endDate}`,
          rows: [
            { Item: 'Wash revenue', Amount: totals.revenue.toFixed(2) },
            { Item: 'Total expenses', Amount: totals.totalExpenses.toFixed(2) },
            { Item: 'Revenue less expenses', Amount: totals.profit.toFixed(2) },
            { Item: 'Cash received', Amount: totals.received.Cash.toFixed(2) },
            { Item: 'Cash expenses', Amount: totals.spent.Cash.toFixed(2) },
            { Item: 'Cash banked', Amount: totals.banked.toFixed(2) },
            { Item: 'Cash still to bank', Amount: totals.cashToBank.toFixed(2) },
          ],
        },
        {
          title: 'EXPENSES',
          rows: expenses.map((e) => ({
            Date: e.date,
            Category: e.category,
            Description: e.description,
            'Paid from': e.source,
            Amount: e.amount.toFixed(2),
            'Recorded by': e.userName,
          })),
        },
        {
          title: 'BANK DEPOSITS',
          rows: deposits.map((d) => ({
            Date: d.date,
            Amount: d.amount.toFixed(2),
            Reference: d.reference ?? '',
            'Recorded by': d.userName,
          })),
        },
      ])
    );

  if (expensesError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Expenses could not be loaded</AlertTitle>
        <AlertDescription className="text-xs">
          Deploy the latest Firestore rules (firebase deploy --only firestore:rules) to enable the expenses and
          bankDeposits collections.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="exp-from" className="text-xs text-muted-foreground">From</Label>
          <Input id="exp-from" type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} className="w-[160px]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exp-to" className="text-xs text-muted-foreground">To</Label>
          <Input id="exp-to" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="w-[160px]" />
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={loading}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: 'Wash revenue', value: totals.revenue },
          { label: 'Expenses', value: totals.totalExpenses },
          { label: 'Revenue less expenses', value: totals.profit, tone: totals.profit < 0 ? 'text-destructive' : '' },
          { label: 'Cash still to bank', value: totals.cashToBank, tone: 'text-primary' },
        ].map((m) => (
          <Card key={m.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{m.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-24" /> : <p className={`text-2xl font-bold tabular-nums ${m.tone ?? ''}`}>{formatCurrency(m.value)}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Record an expense</CardTitle>
            <CardDescription>Anything paid out: soap, fuel, repairs, wages, ZESCO.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveExpense} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="expense-date">Date</Label>
                  <Input id="expense-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expense-amount">Amount (K)</Label>
                  <Input id="expense-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-description">Description</Label>
                <Input id="expense-description" placeholder="e.g. 20L car shampoo" value={description} onChange={(e) => setDescription(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Paid from</Label>
                <Select value={source} onValueChange={(v) => setSource(v as ExpenseSource)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => <SelectItem key={s} value={s}>{sourceLabel[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record expense
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Banking</CardTitle>
              <CardDescription>Money in, money out, by where it sits.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Spent</TableHead>
                      <TableHead className="text-right">Left</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SOURCES.map((s) => (
                      <TableRow key={s}>
                        <TableCell className="font-medium">{s}</TableCell>
                        <TableCell className="text-right tabular-nums">{s === 'Bank' ? '—' : formatCurrency(totals.received[s])}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(totals.spent[s])}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {s === 'Bank' ? '—' : formatCurrency(roundMoney(totals.received[s] - totals.spent[s]))}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-medium">Cash banked</TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-right tabular-nums">−{formatCurrency(totals.banked)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-semibold">Cash still to bank</TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-right font-bold tabular-nums">{formatCurrency(totals.cashToBank)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Corporate washes aren&apos;t here until the company pays — see Corporate.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5" /> Record a bank deposit</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveDeposit} className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.3fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="dep-date">Date</Label>
                  <Input id="dep-date" type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dep-amount">Amount (K)</Label>
                  <Input id="dep-amount" inputMode="decimal" placeholder="0.00" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
                </div>
                <div className="col-span-2 space-y-2 sm:col-span-1">
                  <Label htmlFor="dep-ref">Slip / reference</Label>
                  <Input id="dep-ref" placeholder="Optional" value={depositRef} onChange={(e) => setDepositRef(e.target.value)} />
                </div>
                <Button type="submit" disabled={savingDeposit} className="col-span-2 sm:col-span-1">
                  {savingDeposit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      {totals.byCategory.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Spending by category</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {totals.byCategory.map(([name, value]) => (
              <div key={name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{name}</span>
                  <span className="font-medium tabular-nums">{formatCurrency(value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${totals.totalExpenses ? (value / totals.totalExpenses) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Expense history</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Paid from</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {expensesLoading && (
                <TableRow><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              )}
              {!expensesLoading && expenses.length === 0 && (
                <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No expenses in this period.</TableCell></TableRow>
              )}
              {expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                  <TableCell>{e.category}</TableCell>
                  <TableCell className="font-medium">{e.description}</TableCell>
                  <TableCell>{e.source}</TableCell>
                  <TableCell className="text-muted-foreground">{e.userName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(e.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant={confirmDelete === e.id ? 'destructive' : 'ghost'} size="sm" onClick={() => remove('expenses', e.id)}>
                      {confirmDelete === e.id ? 'Tap to delete' : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {deposits.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 font-semibold">Bank deposits</h3>
              <Table>
                <TableBody>
                  {deposits.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap">{d.date}</TableCell>
                      <TableCell className="font-mono text-xs">{d.reference || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{d.userName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(d.amount)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant={confirmDelete === d.id ? 'destructive' : 'ghost'} size="sm" onClick={() => remove('bankDeposits', d.id)}>
                          {confirmDelete === d.id ? 'Tap to delete' : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
