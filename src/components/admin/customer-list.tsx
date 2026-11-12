'use client';

import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import type { Customer } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { calcTier, tierClasses, TIERS } from '@/lib/loyalty';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Download, Trophy, Users, Star, TriangleAlert } from 'lucide-react';

export function CustomerList() {
  const firestore = useFirestore();
  const [search, setSearch] = useState('');

  // No orderBy: ordering in the query would silently drop any customer missing
  // the ordered field. Sorted client-side instead.
  const customersQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'customers') : null),
    [firestore]
  );
  const { data: customers, isLoading, error } = useCollection<Customer>(customersQuery);

  const ranked = useMemo(
    () => [...(customers ?? [])].sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0)),
    [customers]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter(
      (c) =>
        c.name?.toLowerCase().includes(needle) ||
        c.phoneNumber?.includes(needle) ||
        c.lastPlate?.toLowerCase().includes(needle)
    );
  }, [ranked, search]);

  const tierCounts = useMemo(() => {
    const counts = { Platinum: 0, Gold: 0, Silver: 0, Bronze: 0 };
    for (const c of ranked) counts[calcTier(c.totalPoints ?? 0)] += 1;
    return counts;
  }, [ranked]);

  const exportCsv = () => {
    downloadCsv(
      'spillway-customers.csv',
      toCsv(
        ranked.map((c) => ({
          Name: c.name ?? '',
          Phone: c.phoneNumber ?? '',
          Tier: calcTier(c.totalPoints ?? 0),
          Points: c.totalPoints ?? 0,
          Visits: c.totalVisits ?? 0,
          'Total Spend': (c.totalSpend ?? 0).toFixed(2),
          'Last Visit': c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : '',
          'Last Plate': c.lastPlate ?? '',
        }))
      )
    );
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Could not load customers</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Deploy the Firestore rules, then reload:</p>
          <code className="block font-mono text-xs">firebase deploy --only firestore:rules</code>
          <p className="text-xs opacity-80">{error.message}</p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {TIERS.map((tier) => (
          <Card key={tier}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{tier}</CardTitle>
              <Trophy className={`h-4 w-4 ${tierClasses[tier].split(' ')[1]}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tierCounts[tier]}</div>
              <p className="text-xs text-muted-foreground">members</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> All Customers
          </CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Search name, phone or plate…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-[240px]"
            />
            <Button variant="outline" onClick={exportCsv} disabled={ranked.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
                <TableHead>Last Visit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {search
                      ? 'No customers match your search.'
                      : 'No customers yet. They appear here after their first paid wash, as long as the vehicle has a phone number saved.'}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                filtered.map((c, idx) => {
                  const tier = calcTier(c.totalPoints ?? 0);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{c.name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{c.phoneNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={tierClasses[tier]}>
                          <Star className="mr-1 h-3 w-3" />
                          {tier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{c.totalPoints ?? 0}</TableCell>
                      <TableCell className="text-right">{c.totalVisits ?? 0}</TableCell>
                      <TableCell className="text-right">{formatCurrency(c.totalSpend ?? 0)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
