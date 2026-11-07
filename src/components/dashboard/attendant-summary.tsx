'use client';

import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { useCollection } from '@/firebase/firestore/use-collection';
import type { Transaction } from '@/lib/types';
import { formatCurrency, todayIso } from '@/lib/utils';
import { amountByMethod, describeMethods, roundMoney } from '@/lib/payments';
import { isRevenue } from '@/lib/transactions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Banknote, Briefcase, Car, Smartphone, TriangleAlert } from 'lucide-react';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function presetRange(p: Exclude<Preset, 'custom'>) {
  const t = new Date();
  if (p === 'today') return { start: iso(t), end: iso(t) };
  if (p === 'yesterday') {
    const y = new Date(t);
    y.setDate(y.getDate() - 1);
    return { start: iso(y), end: iso(y) };
  }
  if (p === 'week') {
    const s = new Date(t);
    s.setDate(s.getDate() - 6);
    return { start: iso(s), end: iso(t) };
  }
  return { start: iso(new Date(t.getFullYear(), t.getMonth(), 1)), end: iso(t) };
}

/**
 * "My Shift": what this attendant took payment for, and how much cash they
 * should be holding. Attendants only see their own takings here.
 */
export function AttendantSummary() {
  const firestore = useFirestore();
  const { user } = useUser();
  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState(() => presetRange('today'));

  // One equality filter → automatic index. The date range is applied below.
  const q = useMemoFirebase(
    () => (firestore && user ? query(collection(firestore, 'transactions'), where('completedByUid', '==', user.uid)) : null),
    [firestore, user]
  );
  const { data, isLoading, error } = useCollection<Transaction>(q);

  const s = useMemo(() => {
    const from = new Date(`${range.start}T00:00:00`).getTime();
    const to = new Date(`${range.end}T23:59:59.999`).getTime();
    const rows = (data ?? [])
      .filter(isRevenue)
      .filter((t) => {
        const at = Date.parse(t.completedAt ?? t.timestamp);
        return at >= from && at <= to;
      })
      .sort((a, b) => (b.completedAt ?? b.timestamp).localeCompare(a.completedAt ?? a.timestamp));
    return {
      rows,
      total: roundMoney(rows.reduce((a, t) => a + t.totalAmount, 0)),
      cash: roundMoney(rows.reduce((a, t) => a + amountByMethod(t, 'Cash'), 0)),
      mobile: roundMoney(rows.reduce((a, t) => a + amountByMethod(t, 'Mobile Money'), 0)),
      corporate: roundMoney(rows.reduce((a, t) => a + amountByMethod(t, 'Corporate Account'), 0)),
    };
  }, [data, range]);

  const choose = (p: Exclude<Preset, 'custom'>) => {
    setPreset(p);
    setRange(presetRange(p));
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Your shift could not be loaded</AlertTitle>
        <AlertDescription className="text-xs">{error.message}</AlertDescription>
      </Alert>
    );
  }

  const tiles = [
    { label: 'Cash you should hold', value: formatCurrency(s.cash), icon: Banknote, strong: true },
    { label: 'Mobile money', value: formatCurrency(s.mobile), icon: Smartphone },
    { label: 'On company accounts', value: formatCurrency(s.corporate), icon: Briefcase },
    { label: 'Cars you took payment for', value: String(s.rows.length), icon: Car },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        {(['today', 'yesterday', 'week', 'month'] as const).map((p) => (
          <Button key={p} size="sm" variant={preset === p ? 'default' : 'outline'} onClick={() => choose(p)}>
            {{ today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'This month' }[p]}
          </Button>
        ))}
        <Input
          type="date"
          value={range.start}
          max={todayIso()}
          onChange={(e) => {
            setPreset('custom');
            setRange((r) => ({ start: e.target.value, end: e.target.value > r.end ? e.target.value : r.end }));
          }}
          className="w-[150px]"
          aria-label="From"
        />
        <Input
          type="date"
          value={range.end}
          min={range.start}
          max={todayIso()}
          onChange={(e) => {
            setPreset('custom');
            setRange((r) => ({ ...r, end: e.target.value }));
          }}
          className="w-[150px]"
          aria-label="To"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className={t.strong ? 'border-primary' : ''}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
              <t.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-20" /> : <p className="text-2xl font-bold tabular-nums">{t.value}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Washes you completed</CardTitle>
          <CardDescription>Total taken: {formatCurrency(s.total)}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Plate</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Paid by</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              )}
              {!isLoading && s.rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">No payments taken by you in this period.</TableCell></TableRow>
              )}
              {s.rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(t.completedAt ?? t.timestamp).toLocaleString('en-ZM', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </TableCell>
                  <TableCell className="font-medium">{t.licensePlate}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.services.map((x) => x.name).join(', ')}</TableCell>
                  <TableCell>
                    <span className="text-sm">{describeMethods(t)}</span>
                    {t.status === 'Pending Payment' && <Badge variant="outline" className="ml-2 text-xs">owed</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(t.totalAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
