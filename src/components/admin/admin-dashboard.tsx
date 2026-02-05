"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Car, BarChart, Users } from 'lucide-react';
import { transactions as allTransactions } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { Bar, BarChart as RechartsBarChart, XAxis, YAxis, CartesianGrid } from "recharts";
import type { ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';

type TimeFilter = 'today' | 'week' | 'month';

export function AdminDashboard() {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today');

  const filteredTransactions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    return allTransactions.filter(t => {
      const tDate = new Date(t.timestamp);
      if (timeFilter === 'today') {
        return tDate >= today;
      }
      if (timeFilter === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        return tDate >= weekAgo;
      }
      if (timeFilter === 'month') {
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        return tDate >= monthAgo;
      }
      return true;
    });
  }, [timeFilter]);

  const totalRevenue = filteredTransactions.reduce((acc, t) => acc + t.totalAmount, 0);
  const totalVehicles = filteredTransactions.length;
  const cashTotal = filteredTransactions.filter(t => t.payment.method === 'Cash').reduce((acc, t) => acc + t.totalAmount, 0);
  const mobileMoneyTotal = filteredTransactions.filter(t => t.payment.method === 'Mobile Money').reduce((acc, t) => acc + t.totalAmount, 0);

  const servicePerformance = useMemo(() => {
    const serviceCount: { [key: string]: number } = {};
    for (const transaction of filteredTransactions) {
      for (const service of transaction.services) {
        serviceCount[service.name] = (serviceCount[service.name] || 0) + 1;
      }
    }
    return Object.entries(serviceCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredTransactions]);

  const chartConfig = {
    count: {
      label: "Washes",
      color: "hsl(var(--primary))",
    },
  } satisfies ChartConfig;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <Select value={timeFilter} onValueChange={(value: TimeFilter) => setTimeFilter(value)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">from {totalVehicles} transactions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vehicles Washed</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalVehicles}</div>
            <p className="text-xs text-muted-foreground">in the selected period</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cash Payments</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(cashTotal)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mobile Money</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(mobileMoneyTotal)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Service Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {servicePerformance.length > 0 ? (
            <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
              <RechartsBarChart accessibilityLayer data={servicePerformance}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} tickMargin={10} axisLine={false} />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} />
              </RechartsBarChart>
            </ChartContainer>
            ) : (
                <div className="flex h-[200px] items-center justify-center text-muted-foreground">No data for this period.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>License Plate</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransactions.slice(0, 5).map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.licensePlate}</TableCell>
                    <TableCell>{formatCurrency(t.totalAmount)}</TableCell>
                    <TableCell>
                      <Badge variant={t.payment.method === 'Cash' ? 'secondary' : 'default'}>
                        {t.payment.method}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(t.timestamp).toLocaleTimeString()}</TableCell>
                  </TableRow>
                ))}
                 {filteredTransactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No transactions for this period.
                    </TableCell>
                  </TableRow>
                 )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
