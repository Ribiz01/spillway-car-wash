'use client';

import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { Banknote, Car, Info, TriangleAlert, Wallet } from 'lucide-react';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { useCollection } from '@/firebase/firestore/use-collection';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Transaction } from '@/lib/types';
import { formatCurrency, todayIso, startOfLocalDayIso, endOfLocalDayIso } from '@/lib/utils';
import { amountByMethod, roundMoney } from '@/lib/payments';
import { isRevenue } from '@/lib/transactions';

type Preset = 'today' | 'yesterday' | 'last7' | 'month' | 'custom';

const presetLabels: Record<Exclude<Preset, 'custom'>, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  month: 'This month',
};

/** Local-timezone YYYY-MM-DD, the format the native date input expects. */
function toDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function rangeForPreset(preset: Exclude<Preset, 'custom'>) {
  const today = new Date();
  switch (preset) {
    case 'today':
      return { start: toDateInput(today), end: toDateInput(today) };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { start: toDateInput(y), end: toDateInput(y) };
    }
    case 'last7': {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { start: toDateInput(from), end: toDateInput(today) };
    }
    case 'month':
      return {
        start: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
        end: toDateInput(today),
      };
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * "My Shift" — what this attendant personally took, over a period they choose.
 *
 * Cash only, on purpose. Mobile money, transfers and account washes never pass
 * through the attendant's hands, so showing their amounts here would only give
 * them a bigger number to count the drawer against. An admin reconciles those.
 */
export function AttendantSummary() {
  const [preset, setPreset] = useState<Preset>('today');
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);

  const firestore = useFirestore();
  const { user, isLoading: isUserLoading } = useUser();

  // Range on `timestamp` alone, so the automatic single-field index serves it.
  // Narrowing to this attendant in the query would need a composite index — and
  // would miss cars checked in by a colleague but paid for by this person.
  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !startDate || !endDate) return null;
    return query(
      collection(firestore, 'transactions'),
      where('timestamp', '>=', startOfLocalDayIso(startDate)),
      where('timestamp', '<=', endOfLocalDayIso(endDate))
    );
  }, [firestore, user, startDate, endDate]);

  const { data, isLoading: areTransactionsLoading, error } = useCollection<Transaction>(transactionsQuery);
  const isLoading = isUserLoading || areTransactionsLoading;

  const applyPreset = (value: Preset) => {
    setPreset(value);
    if (value === 'custom') return;
    const range = rangeForPreset(value);
    setStartDate(range.start);
    setEndDate(range.end);
  };

  // Washes this person took payment for. The cash sits with whoever accepted
  // it, not whoever checked the car in; older rows fall back to userId.
  const washes = useMemo(
    () =>
      (data ?? [])
        .filter(isRevenue)
        .filter((t) => (t.completedByUid ?? t.userId) === user?.uid)
        .sort((a, b) => (b.completedAt ?? b.timestamp).localeCompare(a.completedAt ?? a.timestamp)),
    [data, user?.uid]
  );

  const cashWashes = useMemo(() => washes.filter((t) => amountByMethod(t, 'Cash') > 0), [washes]);
  const cashAtHand = roundMoney(cashWashes.reduce((acc, t) => acc + amountByMethod(t, 'Cash'), 0));
  const nonCashCount = washes.length - cashWashes.length;

  const periodLabel =
    startDate === endDate
      ? new Date(`${startDate}T00:00:00`).toLocaleDateString()
      : `${new Date(`${startDate}T00:00:00`).toLocaleDateString()} – ${new Date(`${endDate}T00:00:00`).toLocaleDateString()}`;

  return (
    <div className="space-y-6">
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        <Select value={preset} onValueChange={(v) => applyPreset(v as Preset)}>
          <SelectTrigger className="col-span-2 w-full sm:col-span-1 sm:w-[160px]" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(presetLabels) as Array<keyof typeof presetLabels>).map((key) => (
              <SelectItem key={key} value={key}>{presetLabels[key]}</SelectItem>
            ))}
            <SelectItem value="custom">Custom range</SelectItem>
          </SelectContent>
        </Select>
        <Input
          aria-label="Start date"
          type="date"
          value={startDate}
          max={endDate}
          onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); }}
          className="w-full sm:w-[150px]"
        />
        <Input
          aria-label="End date"
          type="date"
          value={endDate}
          min={startDate}
          max={todayIso()}
          onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); }}
          className="w-full sm:w-[150px]"
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Your shift could not be loaded</AlertTitle>
          <AlertDescription className="text-xs">
            No figures are shown rather than a misleading zero. You can still record
            washes as normal.
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cash at Hand</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums">{formatCurrency(cashAtHand)}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  from {cashWashes.length} cash wash{cashWashes.length !== 1 ? 'es' : ''} · {periodLabel}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cars Completed</CardTitle>
                <Car className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{washes.length}</div>
                <p className="mt-1 text-xs text-muted-foreground">you took payment for in this period</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Non-Cash Washes</CardTitle>
                <Banknote className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{nonCashCount}</div>
                <p className="mt-1 text-xs text-muted-foreground">no cash collected — settled by the office</p>
              </CardContent>
            </Card>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Cash only</AlertTitle>
            <AlertDescription>
              This shows the cash you should be holding. Mobile money, transfers and
              account amounts are not shown here — an admin reconciles those.
            </AlertDescription>
          </Alert>

          <Card>
            <CardContent className="pt-6">
              <Tabs defaultValue="cash">
                <TabsList className="mb-4">
                  <TabsTrigger value="cash">
                    Cash Collected
                    {cashWashes.length > 0 && (
                      <span className="ml-2 rounded-full bg-muted px-2 text-xs">{cashWashes.length}</span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="washes">
                    All Washes
                    {washes.length > 0 && (
                      <span className="ml-2 rounded-full bg-muted px-2 text-xs">{washes.length}</span>
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="cash">
                  {cashWashes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nothing was paid to you in cash during this period.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>License Plate</TableHead>
                          <TableHead>Services</TableHead>
                          <TableHead className="text-right">Cash In</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cashWashes.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="whitespace-nowrap text-sm">{when(t.completedAt ?? t.timestamp)}</TableCell>
                            <TableCell className="font-medium">{t.licensePlate}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {t.services.map((s) => s.name).join(', ')}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {formatCurrency(amountByMethod(t, 'Cash'))}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell colSpan={3} className="font-semibold">Total cash at hand</TableCell>
                          <TableCell className="text-right text-lg font-bold tabular-nums">
                            {formatCurrency(cashAtHand)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                <TabsContent value="washes">
                  {washes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      You have not completed any washes in this period.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>License Plate</TableHead>
                          <TableHead>Services</TableHead>
                          <TableHead>Washers</TableHead>
                          <TableHead className="text-right">Cash</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {washes.map((t) => {
                          const cash = amountByMethod(t, 'Cash');
                          return (
                            <TableRow key={t.id}>
                              <TableCell className="whitespace-nowrap text-sm">{when(t.completedAt ?? t.timestamp)}</TableCell>
                              <TableCell className="font-medium">{t.licensePlate}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {t.services.map((s) => s.name).join(', ')}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {t.assignedWashers?.map((w) => w.name).join(', ') || t.washerName || '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                {cash > 0 ? (
                                  <span className="font-semibold tabular-nums">{formatCurrency(cash)}</span>
                                ) : (
                                  <Badge variant="outline">Non-cash</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
