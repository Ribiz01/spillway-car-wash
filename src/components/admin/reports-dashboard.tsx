'use client';

import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useUser } from '@/firebase/auth/use-user';
import type { Customer, Expense, Transaction } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';
import {
  PAYMENT_METHODS,
  corporateOutstanding,
  describeMethods,
  roundMoney,
  totalsByMethod,
} from '@/lib/payments';
import { isRevenue } from '@/lib/transactions';
import { calcTier, tierClasses } from '@/lib/loyalty';
import { ALL_LOCATIONS, matchesLocationFilter } from '@/lib/locations';
import { LocationFilter } from '@/components/location-filter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BarChart2, FileText, Star, TriangleAlert, Users } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts';

const PIE_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--primary))',
];

const trendConfig = {
  revenue: { label: 'Revenue', color: 'hsl(var(--chart-2))' },
  expenses: { label: 'Expenses', color: 'hsl(var(--chart-5))' },
} satisfies ChartConfig;

const serviceConfig = {
  count: { label: 'Washes', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

const methodConfig = {
  value: { label: 'Received' },
} satisfies ChartConfig;

const pad = (n: number) => String(n).padStart(2, '0');
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const dateKey = (d: Date) => `${monthKey(d)}-${pad(d.getDate())}`;

function monthLabel(key: string, short = false) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: short ? 'short' : 'long',
    year: short ? '2-digit' : 'numeric',
  });
}

/**
 * The periods a month's report needs. For the month in progress, "previous" is
 * cut off at the same day and time last month — comparing 12 days of this month
 * against all 31 of the last would make every figure look like a collapse.
 */
function monthWindows(key: string) {
  const [year, month] = key.split('-').map(Number);
  const now = new Date();
  const isCurrent = key === monthKey(now);
  const start = new Date(year, month - 1, 1);
  const end = isCurrent ? now : new Date(year, month, 0, 23, 59, 59, 999);
  const prevStart = new Date(year, month - 2, 1);
  const prevLastDay = new Date(year, month - 1, 0).getDate();
  const prevEnd = isCurrent
    ? new Date(
        prevStart.getFullYear(),
        prevStart.getMonth(),
        Math.min(now.getDate(), prevLastDay),
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds()
      )
    : new Date(year, month - 1, 0, 23, 59, 59, 999);
  const trendStart = new Date(year, month - 12, 1);
  return { isCurrent, start, end, prevStart, prevEnd, trendStart };
}

function duration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

const clock = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

/** Everything the report shows about one period, derived in one pass. */
function summarise(rows: Transaction[], expenses: Expense[]) {
  const sales = rows.filter(isRevenue);
  const revenue = roundMoney(sales.reduce((acc, t) => acc + t.totalAmount, 0));
  // Still owed: on account and not yet covered by a settlement.
  const outstanding = roundMoney(
    sales
      .filter((t) => t.status === 'Pending Payment' && !t.settlementId)
      .reduce((acc, t) => acc + corporateOutstanding(t), 0)
  );
  const expenseTotal = roundMoney(expenses.reduce((acc, e) => acc + e.amount, 0));
  const timed = sales.filter((t) => typeof t.washDurationSeconds === 'number');
  return {
    sales,
    revenue,
    washes: sales.length,
    average: sales.length ? roundMoney(revenue / sales.length) : 0,
    outstanding,
    expenseTotal,
    net: roundMoney(revenue - outstanding - expenseTotal),
    avgDuration: timed.length
      ? timed.reduce((acc, t) => acc + (t.washDurationSeconds ?? 0), 0) / timed.length
      : null,
  };
}

function changeLabel(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 'New this month' : 'No change';
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
}

function changeClass(current: number, previous: number, lowerIsBetter = false) {
  if (current === previous) return 'text-muted-foreground';
  const good = lowerIsBetter ? current < previous : current > previous;
  return good ? 'text-emerald-600' : 'text-destructive';
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function ReportsDashboard() {
  const firestore = useFirestore();
  const { user } = useUser();
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const [locationFilter, setLocationFilter] = useState(ALL_LOCATIONS);
  const maxMonth = monthKey(new Date());
  const win = useMemo(() => monthWindows(selectedMonth), [selectedMonth]);

  // One read covers the selected month, the comparison month and the 12-month
  // trend. Single-field ranges only, so no composite index is required.
  const txQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, 'transactions'),
      where('timestamp', '>=', win.trendStart.toISOString()),
      where('timestamp', '<=', win.end.toISOString())
    );
  }, [firestore, user, win]);
  const { data: txDocs, isLoading: txLoading, error: txError } = useCollection<Transaction>(txQuery);

  const expenseQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, 'expenses'),
      where('date', '>=', dateKey(win.trendStart)),
      where('date', '<=', dateKey(win.end))
    );
  }, [firestore, user, win]);
  const { data: expenseDocs, isLoading: expensesLoading, error: expenseError } =
    useCollection<Expense>(expenseQuery);

  const customersQuery = useMemoFirebase(
    () => (firestore && user ? collection(firestore, 'customers') : null),
    [firestore, user]
  );
  const { data: customers, isLoading: customersLoading } = useCollection<Customer>(customersQuery);

  const loadError = txError || expenseError;
  const isLoading = txLoading || expensesLoading;

  const allTx = useMemo(
    () => (txDocs ?? []).filter((t) => matchesLocationFilter(t, locationFilter)),
    [txDocs, locationFilter]
  );
  const allExpenses = useMemo(
    () => (expenseDocs ?? []).filter((e) => matchesLocationFilter(e, locationFilter)),
    [expenseDocs, locationFilter]
  );

  const between = (t: Transaction, from: Date, to: Date) => {
    const ts = new Date(t.timestamp).getTime();
    return ts >= from.getTime() && ts <= to.getTime();
  };

  const monthTx = useMemo(() => allTx.filter((t) => between(t, win.start, win.end)), [allTx, win]);
  const prevTx = useMemo(() => allTx.filter((t) => between(t, win.prevStart, win.prevEnd)), [allTx, win]);
  const monthExpenses = useMemo(
    () =>
      allExpenses
        .filter((e) => e.date >= dateKey(win.start) && e.date <= dateKey(win.end))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [allExpenses, win]
  );
  const prevExpenses = useMemo(
    () => allExpenses.filter((e) => e.date >= dateKey(win.prevStart) && e.date <= dateKey(win.prevEnd)),
    [allExpenses, win]
  );

  const current = useMemo(() => summarise(monthTx, monthExpenses), [monthTx, monthExpenses]);
  const previous = useMemo(() => summarise(prevTx, prevExpenses), [prevTx, prevExpenses]);

  const trend = useMemo(() => {
    const buckets = new Map<string, { revenue: number; expenses: number }>();
    for (let i = 0; i <= 12; i++) {
      const d = new Date(win.trendStart.getFullYear(), win.trendStart.getMonth() + i, 1);
      buckets.set(monthKey(d), { revenue: 0, expenses: 0 });
    }
    for (const t of allTx.filter(isRevenue)) {
      const bucket = buckets.get(monthKey(new Date(t.timestamp)));
      if (bucket) bucket.revenue += t.totalAmount;
    }
    for (const e of allExpenses) {
      const bucket = buckets.get(e.date.slice(0, 7));
      if (bucket) bucket.expenses += e.amount;
    }
    return [...buckets.entries()].map(([key, v]) => ({
      month: monthLabel(key, true),
      revenue: roundMoney(v.revenue),
      expenses: roundMoney(v.expenses),
    }));
  }, [allTx, allExpenses, win]);

  const serviceStats = useMemo(() => {
    const stats = new Map<string, { count: number; revenue: number }>();
    for (const t of current.sales) {
      for (const s of t.services) {
        const entry = stats.get(s.name) ?? { count: 0, revenue: 0 };
        entry.count += 1;
        entry.revenue += s.price;
        stats.set(s.name, entry);
      }
    }
    return [...stats.entries()]
      .map(([name, v]) => ({ name, count: v.count, revenue: roundMoney(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [current.sales]);

  const methodShare = useMemo(() => {
    const totals = totalsByMethod(current.sales);
    return PAYMENT_METHODS.map((method) => ({ name: method, value: totals[method] })).filter((m) => m.value > 0);
  }, [current.sales]);

  const dayTx = useMemo(
    () =>
      monthTx
        .filter((t) => dateKey(new Date(t.timestamp)) === selectedDay)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [monthTx, selectedDay]
  );

  const frequent = useMemo(
    () => [...(customers ?? [])].sort((a, b) => (b.totalVisits ?? 0) - (a.totalVisits ?? 0)).slice(0, 10),
    [customers]
  );
  const spenders = useMemo(
    () => [...(customers ?? [])].sort((a, b) => (b.totalSpend ?? 0) - (a.totalSpend ?? 0)).slice(0, 10),
    [customers]
  );

  const onMonthChange = (value: string) => {
    if (!value) return;
    setSelectedMonth(value);
    // Keep the daily table inside the month being viewed.
    setSelectedDay(value === maxMonth ? dateKey(new Date()) : `${value}-01`);
  };

  const exportPdf = () => {
    const fmt = (n: number) => `ZMW ${n.toFixed(2)}`;
    const share = (n: number) => (current.revenue > 0 ? `${((n / current.revenue) * 100).toFixed(1)}%` : '—');
    const rows = (cells: string[][], empty: string, cols: number) =>
      cells.length
        ? cells.map((r) => `<tr>${r.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${cols}" style="color:#999">${empty}</td></tr>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Spillway report — ${escapeHtml(monthLabel(selectedMonth))}</title>
<style>
  body{font-family:Arial,sans-serif;color:#111;padding:32px;font-size:13px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#666;margin:0 0 24px}
  h2{font-size:15px;border-bottom:1px solid #ddd;padding-bottom:4px;margin:24px 0 12px}
  table{width:100%;border-collapse:collapse} th{background:#f0f0f0;text-align:left;padding:6px 8px;font-size:12px}
  td{padding:6px 8px;border-bottom:1px solid #eee} .num{text-align:right}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
  .stat{border:1px solid #ddd;border-radius:6px;padding:12px 16px}
  .label{font-size:11px;color:#666;margin-bottom:4px} .value{font-size:20px;font-weight:bold}
  .footer{margin-top:40px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:8px}
  @media print{body{padding:16px}}
</style></head><body>
<h1>Spillway Car Wash &amp; Grill — Monthly Report</h1>
<p class="sub">${escapeHtml(monthLabel(selectedMonth))}${win.isCurrent ? ' (month to date)' : ''} · ${current.washes} wash${current.washes === 1 ? '' : 'es'}</p>
<h2>Summary</h2>
<div class="grid">
  <div class="stat"><div class="label">Revenue</div><div class="value">${fmt(current.revenue)}</div></div>
  <div class="stat"><div class="label">Expenses</div><div class="value">${fmt(current.expenseTotal)}</div></div>
  <div class="stat"><div class="label">Owed on account</div><div class="value">${fmt(current.outstanding)}</div></div>
  <div class="stat"><div class="label">Net collected</div><div class="value">${fmt(current.net)}</div></div>
</div>
<h2>Payment Methods</h2>
<table><thead><tr><th>Method</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>
${rows(methodShare.map((m) => [escapeHtml(m.name), fmt(m.value), share(m.value)]), 'No payments in this period.', 3)}
</tbody></table>
<h2>Services</h2>
<table><thead><tr><th>Service</th><th class="num">Washes</th><th class="num">Revenue</th><th class="num">Share</th></tr></thead><tbody>
${rows(serviceStats.map((s) => [escapeHtml(s.name), String(s.count), fmt(s.revenue), share(s.revenue)]), 'No services in this period.', 4)}
</tbody></table>
<h2>Expenses</h2>
<table><thead><tr><th>Date</th><th class="num">Description</th><th class="num">Paid from</th><th class="num">Amount</th></tr></thead><tbody>
${rows(monthExpenses.map((e) => [escapeHtml(e.date), escapeHtml(e.description), escapeHtml(e.paymentSource), fmt(e.amount)]), 'No expenses in this period.', 4)}
</tbody></table>
<div class="footer">Generated ${escapeHtml(new Date().toLocaleString())} — Spillway Car Wash &amp; Grill</div>
<script>window.onload = () => window.print();</script>
</body></html>`;

    const popup = window.open('', '_blank');
    if (popup) {
      popup.document.write(html);
      popup.document.close();
    }
  };

  const kpis = [
    { label: 'Revenue', value: formatCurrency(current.revenue), cur: current.revenue, prev: previous.revenue },
    { label: 'Washes', value: String(current.washes), cur: current.washes, prev: previous.washes },
    { label: 'Average ticket', value: formatCurrency(current.average), cur: current.average, prev: previous.average },
    { label: 'Expenses', value: formatCurrency(current.expenseTotal), cur: current.expenseTotal, prev: previous.expenseTotal, lowerIsBetter: true },
    { label: 'Owed on account', value: formatCurrency(current.outstanding), cur: current.outstanding, prev: previous.outstanding, lowerIsBetter: true },
    { label: 'Net collected', value: formatCurrency(current.net), cur: current.net, prev: previous.net },
  ];

  const comparison = [
    { label: 'Revenue', cur: current.revenue, prev: previous.revenue, money: true },
    { label: 'Washes', cur: current.washes, prev: previous.washes },
    { label: 'Average ticket', cur: current.average, prev: previous.average, money: true },
    { label: 'Expenses', cur: current.expenseTotal, prev: previous.expenseTotal, money: true, lowerIsBetter: true },
    { label: 'Owed on account', cur: current.outstanding, prev: previous.outstanding, money: true, lowerIsBetter: true },
    { label: 'Net collected', cur: current.net, prev: previous.net, money: true },
  ];

  const prevHeading = win.isCurrent ? 'Previous month to date' : monthLabel(monthKey(win.prevStart));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">
            Monthly performance, services, payment mix and your best customers.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <LocationFilter value={locationFilter} onChange={setLocationFilter} />
          <div className="space-y-1">
            <Label htmlFor="report-month" className="text-xs text-muted-foreground">Month</Label>
            <Input
              id="report-month"
              type="month"
              value={selectedMonth}
              max={maxMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="w-[170px]"
            />
          </div>
          <Button variant="outline" onClick={exportPdf} disabled={isLoading || !!loadError}>
            <FileText className="mr-2 h-4 w-4" /> Print / PDF
          </Button>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Could not load this report</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>The figures below are incomplete. Deploy the Firestore rules, then reload:</p>
            <code className="block font-mono text-xs">firebase deploy --only firestore:rules</code>
            <p className="text-xs opacity-80">{loadError.message}</p>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2"><BarChart2 className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="services" className="gap-2"><Star className="h-4 w-4" /> Services</TabsTrigger>
          <TabsTrigger value="customers" className="gap-2"><Users className="h-4 w-4" /> Customers</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {kpis.map((k) => (
              <Card key={k.label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className="h-8 w-28" />
                  ) : (
                    <>
                      <div className="text-2xl font-bold tabular-nums">{k.value}</div>
                      <p className={cn('text-xs', changeClass(k.cur, k.prev, k.lowerIsBetter))}>
                        {changeLabel(k.cur, k.prev)} vs {win.isCurrent ? 'last month to date' : 'previous month'}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>12-month trend</CardTitle>
              <CardDescription>Revenue against expenses, ending {monthLabel(selectedMonth)}.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : (
                <ChartContainer config={trendConfig} className="h-[260px] w-full">
                  <BarChart accessibilityLayer data={trend}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} />
                    <YAxis width={56} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
                    <Bar dataKey="expenses" fill="var(--color-expenses)" radius={4} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Month-over-month comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>KPI</TableHead>
                    <TableHead className="text-right">{win.isCurrent ? 'Month to date' : monthLabel(selectedMonth)}</TableHead>
                    <TableHead className="text-right">{prevHeading}</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.money ? formatCurrency(row.cur) : row.cur}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.money ? formatCurrency(row.prev) : row.prev}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', changeClass(row.cur, row.prev, row.lowerIsBetter))}>
                        {changeLabel(row.cur, row.prev)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium">Average time on site</TableCell>
                    <TableCell className="text-right">{duration(current.avgDuration)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{duration(previous.avgDuration)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Daily wash history</CardTitle>
                <CardDescription>Every car recorded on the chosen day, including reversals.</CardDescription>
              </div>
              <Input
                aria-label="Day"
                type="date"
                value={selectedDay}
                min={dateKey(win.start)}
                max={dateKey(win.end)}
                onChange={(e) => e.target.value && setSelectedDay(e.target.value)}
                className="w-[160px]"
              />
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plate</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Services</TableHead>
                    <TableHead>Washers</TableHead>
                    <TableHead>In / Out</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayTx.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.licensePlate}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[t.vehicleMake, t.vehicleModel].filter(Boolean).join(' ') || '—'}
                        {t.bayNumber ? ` · bay ${t.bayNumber}` : ''}
                      </TableCell>
                      <TableCell className="text-sm">{t.services.map((s) => s.name).join(', ')}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.assignedWashers?.map((w) => w.name).join(', ') || t.washerName || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {clock(t.timestamp)} / {clock(t.completedAt)}
                      </TableCell>
                      <TableCell className="text-sm">{duration(t.washDurationSeconds ?? null)}</TableCell>
                      <TableCell className="text-sm">{describeMethods(t)}</TableCell>
                      <TableCell>
                        <Badge variant={isRevenue(t) ? 'secondary' : t.status === 'In Progress' ? 'default' : 'destructive'}>
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(t.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                  {dayTx.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="h-20 text-center text-muted-foreground">
                        {isLoading ? 'Loading…' : 'No washes recorded on this day.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{monthLabel(selectedMonth)} expenses</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Paid from</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthExpenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                      <TableCell className="font-medium">{e.description}</TableCell>
                      <TableCell>{e.paymentSource}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(e.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {monthExpenses.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                        No expenses recorded this month.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Washes by service</CardTitle></CardHeader>
              <CardContent>
                {serviceStats.length === 0 ? (
                  <p className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                    No services sold in this period.
                  </p>
                ) : (
                  <ChartContainer config={serviceConfig} className="h-[240px] w-full">
                    <BarChart accessibilityLayer data={serviceStats}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" tickLine={false} tickMargin={10} axisLine={false} />
                      <YAxis width={32} allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Revenue by payment method</CardTitle></CardHeader>
              <CardContent>
                {methodShare.length === 0 ? (
                  <p className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                    No payments in this period.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <ChartContainer config={methodConfig} className="mx-auto h-[190px] w-full">
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                        <Pie data={methodShare} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>
                          {methodShare.map((m, i) => (
                            <Cell key={m.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>
                    <ul className="grid gap-1 text-sm sm:grid-cols-2">
                      {methodShare.map((m, i) => (
                        <li key={m.name} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-sm"
                              style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                            />
                            {m.name}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{formatCurrency(m.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Service breakdown</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Washes</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">% of revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serviceStats.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right">{s.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(s.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {current.revenue > 0 ? `${((s.revenue / current.revenue) * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {serviceStats.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                        No services sold in this period.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers" className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Lifetime figures across all locations — loyalty follows the customer, not the branch or the month.
          </p>
          <div className="grid gap-6 lg:grid-cols-2">
            {[
              { title: 'Most frequent customers', rows: frequent, metric: (c: Customer) => `${c.totalVisits ?? 0} visits`, head: 'Visits' },
              { title: 'Top spenders', rows: spenders, metric: (c: Customer) => formatCurrency(c.totalSpend ?? 0), head: 'Total spend' },
            ].map((block) => (
              <Card key={block.title}>
                <CardHeader><CardTitle>{block.title}</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Tier</TableHead>
                        <TableHead className="text-right">{block.head}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {block.rows.map((c) => {
                        const tier = calcTier(c.totalPoints ?? 0);
                        return (
                          <TableRow key={c.id}>
                            <TableCell>
                              <div className="font-medium">{c.name || '—'}</div>
                              <div className="text-xs text-muted-foreground">{c.phoneNumber}</div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={tierClasses[tier]}>{tier}</Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{block.metric(c)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {block.rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                            {customersLoading ? 'Loading…' : 'No customers yet.'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
