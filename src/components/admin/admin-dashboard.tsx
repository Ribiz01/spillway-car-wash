"use client";

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Car } from 'lucide-react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { formatCurrency } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import type { Transaction } from '@/lib/types';

const ServicePerformanceChart = dynamic(
  () => import('./service-performance-chart').then((mod) => mod.ServicePerformanceChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full" />,
  }
);


import { Input } from '../ui/input';

export function AdminDashboard() {
  const [startDate, setStartDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const firestore = useFirestore();
  const { user, isLoading: isUserLoading } = useUser();
  
  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;

    let q = collection(firestore, 'transactions');
    
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      q = query(q, where('timestamp', '>=', start.toISOString()));
    }
    
    if (endDate) {
       const end = new Date(endDate);
       end.setHours(23, 59, 59, 999);
       q = query(q, where('timestamp', '<=', end.toISOString()));
    }

    return query(q, orderBy('timestamp', 'desc'));
  }, [firestore, startDate, endDate, user]);

  const { data, isLoading: areTransactionsLoading } = useCollection<Transaction>(transactionsQuery);
  const isLoading = isUserLoading || areTransactionsLoading;

  const filteredTransactions = data || [];

  const completedTransactions = filteredTransactions.filter(t => t.status === 'Completed');

  const totalRevenue = completedTransactions.reduce((acc, t) => acc + t.totalAmount, 0);
  const totalVehicles = filteredTransactions.length;
  const cashTotal = completedTransactions.filter(t => t.payment.method === 'Cash').reduce((acc, t) => acc + t.totalAmount, 0);
  const mobileMoneyTotal = completedTransactions.filter(t => t.payment.method === 'Mobile Money').reduce((acc, t) => acc + t.totalAmount, 0);

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

  const washerPerformance = useMemo(() => {
    const points: { [key: string]: number } = {};
    for (const transaction of completedTransactions) {
      if (transaction.assignedWashers && transaction.assignedWashers.length > 0) {
        const pointShare = 1 / transaction.assignedWashers.length;
        for (const washer of transaction.assignedWashers) {
          points[washer.name] = (points[washer.name] || 0) + pointShare;
        }
      } else if (transaction.washerName) {
        // Fallback for legacy transactions
        points[transaction.washerName] = (points[transaction.washerName] || 0) + 1;
      }
    }
    return Object.entries(points)
      .map(([name, points]) => ({ name, points: Number(points.toFixed(2)) }))
      .sort((a, b) => b.points - a.points);
  }, [completedTransactions]);

  if (isLoading) {
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-10 w-[180px]" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card><CardHeader><Skeleton className="h-5 w-32" /></CardHeader><CardContent><Skeleton className="h-8 w-24" /><Skeleton className="h-4 w-40 mt-1" /></CardContent></Card>
                <Card><CardHeader><Skeleton className="h-5 w-32" /></CardHeader><CardContent><Skeleton className="h-8 w-12" /><Skeleton className="h-4 w-32 mt-1" /></CardContent></Card>
                <Card><CardHeader><Skeleton className="h-5 w-32" /></CardHeader><CardContent><Skeleton className="h-8 w-24" /></CardContent></Card>
                <Card><CardHeader><Skeleton className="h-5 w-32" /></CardHeader><CardContent><Skeleton className="h-8 w-24" /></CardContent></Card>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
                <Card><CardHeader><Skeleton className="h-6 w-48" /></CardHeader><CardContent><Skeleton className="h-[200px] w-full" /></CardContent></Card>
                <Card><CardHeader><Skeleton className="h-6 w-48" /></CardHeader><CardContent><Skeleton className="h-[200px] w-full" /></CardContent></Card>
            </div>
        </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <div className="flex items-center gap-2">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[150px]" />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[150px]" />
        </div>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">from {completedTransactions.length} completed transactions</p>
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
            <ServicePerformanceChart data={servicePerformance} />
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
                  <TableHead>Status</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransactions.slice(0, 5).map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.licensePlate}</TableCell>
                    <TableCell>{formatCurrency(t.totalAmount)}</TableCell>
                    <TableCell>
                      <Badge variant={t.payment.method === 'Cash' ? 'secondary' : (t.payment.method === 'Corporate Account' ? 'outline' : 'default')}>
                        {t.payment.method}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === 'Completed' ? 'secondary' : 'outline'}>
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[100px]">{t.userId}</TableCell>
                    <TableCell>{new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                  </TableRow>
                ))}
                 {filteredTransactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No transactions for this period.
                    </TableCell>
                  </TableRow>
                 )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Washer Performance (Points)</CardTitle>
          </CardHeader>
          <CardContent>
             <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Washer Name</TableHead>
                  <TableHead className="text-right">Points / Washes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {washerPerformance.map(w => (
                  <TableRow key={w.name}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="text-right">{w.points}</TableCell>
                  </TableRow>
                ))}
                 {washerPerformance.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      No washer points for this period.
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
