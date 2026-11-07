'use client';

import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { calcTier, type Customer, type Expense, type Transaction } from '@/lib/types';
import { formatCurrency, todayIso } from '@/lib/utils';
import { amountByMethod, roundMoney } from '@/lib/payments';
import { isRevenue, isReversed } from '@/lib/transactions';
import { downloadCsv, toCsvSections } from '@/lib/csv';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BarChart3, Clock, Download, TrendingDown, TrendingUp, TriangleAlert, Trophy, Users, Wrench } from 'lucide-react';

/** "2026-11" → { start, end } as local-midnight Dates. */
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59, 999) };
}
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const monthKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month: string, style: 'long' | 'short' = 'long') => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZM', { month: style, year: style === 'long' ? 'numeric' : '2-digit' });
};
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
function minutes(sec?: number) {
  if (!sec || sec <= 0) return null;
  return Math.round(sec / 60);
}

function Change({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (before <= 0) return <span className="text-xs text-muted-foreground">no data last month</span>;
  const change = ((now - before) / before) * 100;
  const good = invert ? change <= 0 : change >= 0;
  const Icon = change >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`flex items-center gap-1 text-xs ${good ? 'text-emerald-600' : 'text-destructive'}`}>
      <Icon className="h-3 w-3" /> {change >= 0 ? '+' : ''}
      {change.toFixed(0)}% vs last month
    </span>
  );
}

const trendConfig = {
  revenue: { label: 'Revenue', color: 'hsl(var(--primary))' },
  expenses: { label: 'Expenses', color: 'hsl(var(--chart-5))' },
} satisfies ChartConfig;
const dailyConfig = { revenue: { label: 'Revenue', color: 'hsl(var(--primary))' } } satisfies ChartConfig;
const hourConfig = { cars: { label: 'Cars', color: 'hsl(var(--chart-1))' } } satisfies ChartConfig;

/**
 * Monthly business report: how the month went, how it compares with last month
 * and the last year, what sells, who pays how, and who the regulars are.
 */
export function ReportsDashboard() {
  const firestore = useFirestore();
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));

  // One query for the 12 months ending with the selected month: it feeds the
  // trend chart and the month-over-month comparison. Single-field range only.
  const windowStart = useMemo(() => monthRange(shiftMonth(month, -11)).start.toISOString(), [month]);
  const windowEnd = useMemo(() => monthRange(month).end.toISOString(), [month]);

  const txQuery = useMemoFirebase(
    () =>
      firestore
        ? query(collection(firestore, 'transactions'), where('timestamp', '>=', windowStart), where('timestamp', '<=', windowEnd))
        : null,
    [firestore, windowStart, windowEnd]
  );
  const { data: allTx, isLoading, error } = useCollection<Transaction>(txQuery);

  const expQuery = useMemoFirebase(
    () =>
      firestore
        ? query(
            collection(firestore, 'expenses'),
            where('date', '>=', `${shiftMonth(month, -11)}-01`),
            where('date', '<=', `${month}-31`)
          )
        : null,
    [firestore, month]
  );
  const { data: allExpenses } = useCollection<Expense>(expQuery);

  const custQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(custQuery);

  const r = useMemo(() => {
    const tx = allTx ?? [];
    const exp = allExpenses ?? [];
    const prev = shiftMonth(month, -1);
    const inMonth = (m: string) => tx.filter((t) => monthKey(t.timestamp) === m);
    const cur = inMonth(month);
    const last = inMonth(prev);
    const paid = cur.filter(isRevenue);
    const paidLast = last.filter(isRevenue);
    const expCur = exp.filter((e) => e.date.startsWith(month));
    const expLast = exp.filter((e) => e.date.startsWith(prev));

    const sum = (rows: Transaction[]) => roundMoney(rows.reduce((a, t) => a + t.totalAmount, 0));
    const revenue = sum(paid);
    const revenueLast = sum(paidLast);
    const expenses = roundMoney(expCur.reduce((a, e) => a + e.amount, 0));
    const expensesLast = roundMoney(expLast.reduce((a, e) => a + e.amount, 0));
    const durations = paid.map((t) => t.washDurationSeconds ?? 0).filter((s) => s > 0 && s < 6 * 3600);
    const avgWash = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const methods = {
      Cash: roundMoney(paid.reduce((a, t) => a + amountByMethod(t, 'Cash'), 0)),
      'Mobile Money': roundMoney(paid.reduce((a, t) => a + amountByMethod(t, 'Mobile Money'), 0)),
      'Corporate Account': roundMoney(paid.reduce((a, t) => a + amountByMethod(t, 'Corporate Account'), 0)),
    };

    // 12-month trend
    const trend = Array.from({ length: 12 }, (_, i) => {
      const m = shiftMonth(month, i - 11);
      return {
        month: monthLabel(m, 'short'),
        revenue: sum(inMonth(m).filter(isRevenue)),
        expenses: roundMoney(exp.filter((e) => e.date.startsWith(m)).reduce((a, e) => a + e.amount, 0)),
      };
    });

    // Daily revenue for the month
    const { end } = monthRange(month);
    const daily = Array.from({ length: end.getDate() }, (_, i) => ({ day: String(i + 1), revenue: 0 }));
    for (const t of paid) daily[new Date(t.timestamp).getDate() - 1].revenue += t.totalAmount;
    daily.forEach((d) => (d.revenue = roundMoney(d.revenue)));
    const bestDay = daily.reduce((best, d) => (d.revenue > best.revenue ? d : best), { day: '', revenue: 0 });

    // Busy hours (check-in time)
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, cars: 0 }));
    for (const t of cur.filter((t) => !isReversed(t))) hours[new Date(t.timestamp).getHours()].cars += 1;
    const openHours = hours.filter((h, i) => i >= 6 && i <= 21);

    // Weekday split
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => ({ day: d, cars: 0, revenue: 0 }));
    for (const t of paid) {
      const w = weekdays[new Date(t.timestamp).getDay()];
      w.cars += 1;
      w.revenue += t.totalAmount;
    }

    // Services
    const svc = new Map<string, { count: number; revenue: number }>();
    for (const t of paid)
      for (const s of t.services) {
        const e = svc.get(s.name) ?? { count: 0, revenue: 0 };
        e.count += 1;
        e.revenue += s.price;
        svc.set(s.name, e);
      }
    const services = [...svc.entries()].map(([name, v]) => ({ name, ...v, revenue: roundMoney(v.revenue) })).sort((a, b) => b.revenue - a.revenue);

    // Staff
    const attendants = new Map<string, { name: string; cars: number; revenue: number }>();
    for (const t of paid) {
      const key = t.completedByUid ?? t.userId;
      const e = attendants.get(key) ?? { name: t.completedByName ?? t.userName ?? 'Unknown', cars: 0, revenue: 0 };
      e.cars += 1;
      e.revenue += t.totalAmount;
      attendants.set(key, e);
    }
    const washers = new Map<string, number>();
    for (const t of paid) {
      const list = t.assignedWashers ?? (t.washerName ? [{ id: t.washerName, name: t.washerName }] : []);
      for (const w of list) washers.set(w.name, (washers.get(w.name) ?? 0) + 1 / list.length);
    }

    // Vehicle mix
    const plates = new Set(paid.map((t) => t.licensePlate));
    const plateCounts = new Map<string, number>();
    for (const t of paid) plateCounts.set(t.licensePlate, (plateCounts.get(t.licensePlate) ?? 0) + 1);
    const repeatCars = [...plateCounts.values()].filter((n) => n > 1).length;

    return {
      cur,
      paid,
      revenue,
      revenueLast,
      cars: paid.length,
      carsLast: paidLast.length,
      avgTicket: paid.length ? revenue / paid.length : 0,
      avgTicketLast: paidLast.length ? revenueLast / paidLast.length : 0,
      expenses,
      expensesLast,
      profit: roundMoney(revenue - expenses),
      profitLast: roundMoney(revenueLast - expensesLast),
      reversed: cur.filter(isReversed).length,
      avgWashMin: avgWash ? Math.round(avgWash / 60) : null,
      methods,
      trend,
      daily,
      bestDay,
      hours: openHours,
      weekdays: weekdays.map((w) => ({ ...w, revenue: roundMoney(w.revenue) })),
      services,
      attendants: [...attendants.values()].map((a) => ({ ...a, revenue: roundMoney(a.revenue) })).sort((a, b) => b.revenue - a.revenue),
      washers: [...washers.entries()].map(([name, cars]) => ({ name, cars: Math.round(cars * 10) / 10 })).sort((a, b) => b.cars - a.cars),
      uniqueCars: plates.size,
      repeatCars,
    };
  }, [allTx, allExpenses, month]);

  const topCustomers = useMemo(
    () => [...(customers ?? [])].sort((a, b) => (b.totalSpend ?? 0) - (a.totalSpend ?? 0)).slice(0, 10),
    [customers]
  );

  const exportCsv = () =>
    downloadCsv(
      `spillway-report-${month}.csv`,
      toCsvSections([
        {
          title: `SPILLWAY MONTHLY REPORT — ${monthLabel(month).toUpperCase()}`,
          rows: [
            { Item: 'Revenue', Amount: r.revenue.toFixed(2) },
            { Item: 'Cars washed', Amount: r.cars },
            { Item: 'Average ticket', Amount: r.avgTicket.toFixed(2) },
            { Item: 'Expenses', Amount: r.expenses.toFixed(2) },
            { Item: 'Revenue less expenses', Amount: r.profit.toFixed(2) },
            ...Object.entries(r.methods).map(([k, v]) => ({ Item: k, Amount: v.toFixed(2) })),
            { Item: 'Cancelled / voided', Amount: r.reversed },
          ],
        },
        { title: 'SERVICES', rows: r.services.map((s) => ({ Service: s.name, Washes: s.count, Revenue: s.revenue.toFixed(2) })) },
        { title: 'DAILY REVENUE', rows: r.daily.map((d) => ({ Day: `${month}-${d.day.padStart(2, '0')}`, Revenue: d.revenue.toFixed(2) })) },
        { title: 'ATTENDANTS', rows: r.attendants.map((a) => ({ Attendant: a.name, Cars: a.cars, Revenue: a.revenue.toFixed(2) })) },
        { title: 'WASHERS', rows: r.washers.map((w) => ({ Washer: w.name, 'Cars (shared)': w.cars })) },
        {
          title: 'WASHES',
          rows: r.cur.map((t) => ({
            Date: new Date(t.timestamp).toLocaleString('en-ZM'),
            Plate: t.licensePlate,
            Services: t.services.map((s) => s.name).join('; '),
            Status: t.status,
            Total: t.totalAmount.toFixed(2),
            'Wash minutes': minutes(t.washDurationSeconds) ?? '',
            Attendant: t.completedByName ?? t.userName ?? '',
          })),
        },
      ])
    );

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>The report could not be loaded</AlertTitle>
        <AlertDescription className="text-xs">{error.message}</AlertDescription>
      </Alert>
    );
  }

  const kpis = [
    { label: 'Revenue', value: formatCurrency(r.revenue), now: r.revenue, before: r.revenueLast },
    { label: 'Cars washed', value: String(r.cars), now: r.cars, before: r.carsLast },
    { label: 'Average ticket', value: formatCurrency(r.avgTicket), now: r.avgTicket, before: r.avgTicketLast },
    { label: 'Revenue less expenses', value: formatCurrency(r.profit), now: r.profit, before: r.profitLast },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</Button>
          <Input type="month" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-[170px]" />
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= todayIso().slice(0, 7)}>›</Button>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={isLoading}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {isLoading ? <Skeleton className="h-8 w-24" /> : <p className="text-2xl font-bold tabular-nums">{k.value}</p>}
              {!isLoading && <Change now={k.now} before={k.before} />}
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="services" className="gap-1.5"><Wrench className="h-4 w-4" /> Services &amp; staff</TabsTrigger>
          <TabsTrigger value="customers" className="gap-1.5"><Users className="h-4 w-4" /> Customers</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {Object.entries(r.methods).map(([name, value]) => (
              <Card key={name}>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{name}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-xl font-bold tabular-nums">{formatCurrency(value)}</p>
                  <p className="text-xs text-muted-foreground">{pct(value, r.revenue)} of revenue</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Daily revenue — {monthLabel(month)}</CardTitle>
              <CardDescription>
                {r.bestDay.revenue > 0 ? `Best day: ${r.bestDay.day} ${monthLabel(month)} with ${formatCurrency(r.bestDay.revenue)}.` : 'No paid washes yet this month.'}
                {r.avgWashMin ? ` Average time from check-in to payment: ${r.avgWashMin} min.` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={dailyConfig} className="h-[240px] w-full">
                <BarChart data={r.daily}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} interval={1} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={50} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="revenue" fill="var(--color-revenue)" radius={3} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>12-month trend</CardTitle>
                <CardDescription>Revenue against recorded expenses.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={trendConfig} className="h-[240px] w-full">
                  <BarChart data={r.trend}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} width={55} fontSize={11} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="revenue" fill="var(--color-revenue)" radius={3} />
                    <Bar dataKey="expenses" fill="var(--color-expenses)" radius={3} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Busy hours</CardTitle>
                <CardDescription>Cars checked in by hour this month — plan staff around the peaks.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={hourConfig} className="h-[240px] w-full">
                  <BarChart data={r.hours}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="hour" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} fontSize={11} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="cars" fill="var(--color-cars)" radius={3} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>By day of the week</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>{r.weekdays.map((w) => <TableHead key={w.day} className="text-center">{w.day}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>{r.weekdays.map((w) => <TableCell key={w.day} className="text-center tabular-nums">{w.cars} cars</TableCell>)}</TableRow>
                  <TableRow>{r.weekdays.map((w) => <TableCell key={w.day} className="text-center text-xs tabular-nums text-muted-foreground">{formatCurrency(w.revenue)}</TableCell>)}</TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Services</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Washes</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.services.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No paid washes this month.</TableCell></TableRow>
                  )}
                  {r.services.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(s.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(s.revenue, r.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Attendants</CardTitle>
                <CardDescription>Payments taken this month.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {r.attendants.map((a, i) => (
                      <TableRow key={a.name}>
                        <TableCell className="w-8 text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.cars} cars</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(a.revenue)}</TableCell>
                      </TableRow>
                    ))}
                    {r.attendants.length === 0 && <TableRow><TableCell className="text-muted-foreground">No data.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Washers</CardTitle>
                <CardDescription>Cars washed, shared equally when more than one washer worked on a car.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {r.washers.map((w, i) => (
                      <TableRow key={w.name}>
                        <TableCell className="w-8 text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{w.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{w.cars}</TableCell>
                      </TableRow>
                    ))}
                    {r.washers.length === 0 && <TableRow><TableCell className="text-muted-foreground">No data.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="customers" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Different cars this month</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{r.uniqueCars}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Came back more than once</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{r.repeatCars}</p>
                <p className="text-xs text-muted-foreground">{pct(r.repeatCars, r.uniqueCars)} of cars</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Loyalty members</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{customers?.length ?? '…'}</p></CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4" /> Top 10 customers (all time)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCustomers.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No loyalty customers yet.</TableCell></TableRow>
                  )}
                  {topCustomers.map((c, i) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.phoneNumber}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{calcTier(c.totalPoints ?? 0)}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{c.totalVisits ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(c.totalSpend ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
