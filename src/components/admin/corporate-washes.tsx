"use client";

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCollection } from '@/firebase/firestore/use-collection';
import { formatCurrency } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import type { Transaction } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Briefcase } from 'lucide-react';

export function CorporateWashes() {
  const firestore = useFirestore();
  const { user, isLoading: isUserLoading } = useUser();
  
  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;

    return query(
      collection(firestore, 'transactions'),
      where('payment.method', '==', 'Corporate Account'),
      orderBy('timestamp', 'desc')
    );
  }, [firestore, user]);

  const { data: transactions, isLoading: areTransactionsLoading } = useCollection<Transaction>(transactionsQuery);
  const isLoading = isUserLoading || areTransactionsLoading;

  const totalCorporateRevenue = useMemo(() => {
    if (!transactions) return 0;
    return transactions.reduce((acc, t) => acc + t.totalAmount, 0);
  }, [transactions]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Briefcase className="size-8 text-muted-foreground" />
            <div>
              <CardTitle className="text-base font-semibold">Total Corporate Debt</CardTitle>
              <p className="text-2xl font-bold">{formatCurrency(totalCorporateRevenue)}</p>
            </div>
          </div>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>All Corporate Transactions</CardTitle>
        </CardHeader>
        <CardContent>
            {isLoading && (
                 <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>License Plate</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>User ID</TableHead>
                            <TableHead>Date</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {[...Array(5)].map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                                <TableCell><Skeleton className="h-6 w-28" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            {!isLoading && transactions && transactions.length > 0 && (
                 <Table>
                    <TableHeader>
                        <TableRow>
                        <TableHead>License Plate</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>User ID</TableHead>
                        <TableHead>Date</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {transactions.map(t => (
                        <TableRow key={t.id}>
                            <TableCell className="font-medium">{t.licensePlate}</TableCell>
                            <TableCell>{formatCurrency(t.totalAmount)}</TableCell>
                            <TableCell>
                            <Badge variant={t.status === 'Completed' ? 'secondary' : 'outline'}>
                                {t.status}
                            </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs truncate max-w-[100px]">{t.userId}</TableCell>
                            <TableCell>{new Date(t.timestamp).toLocaleDateString()}</TableCell>
                        </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            {!isLoading && (!transactions || transactions.length === 0) && (
                <Alert>
                    <Briefcase className="h-4 w-4" />
                    <AlertTitle>No Corporate Washes</AlertTitle>
                    <AlertDescription>
                        There are no transactions billed to a corporate account yet.
                    </AlertDescription>
                </Alert>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
