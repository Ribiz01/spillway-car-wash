'use client';

import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { calcTier, TIER_THRESHOLDS, type Customer, type CustomerTier } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Download, MessageCircle, Star, TriangleAlert, Trophy, Users } from 'lucide-react';

const TIERS: CustomerTier[] = ['Platinum', 'Gold', 'Silver', 'Bronze'];

const tierStyles: Record<CustomerTier, string> = {
  Platinum: 'border-purple-400 text-purple-700',
  Gold: 'border-amber-400 text-amber-700',
  Silver: 'border-slate-400 text-slate-600',
  Bronze: 'border-orange-300 text-orange-700',
};

function shortDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Days since a date, or null. */
function daysSince(iso?: string) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

/**
 * Loyalty customers. A customer is created the first time a car with a phone
 * number is paid for, and earns 1 point per K1 paid.
 */
export function CustomerList() {
  const firestore = useFirestore();
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<CustomerTier | 'All'>('All');

  const customersQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'customers') : null),
    [firestore]
  );
  const { data, isLoading, error } = useCollection<Customer>(customersQuery);

  // The tier is always re-derived from points, so a stale stored value never shows.
  const customers = useMemo(
    () =>
      (data ?? [])
        .map((c) => ({ ...c, tier: calcTier(c.totalPoints ?? 0) }))
        .sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0)),
    [data]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (tierFilter === 'All' || c.tier === tierFilter) &&
        (!q ||
          c.name?.toLowerCase().includes(q) ||
          c.phoneNumber?.includes(q.replace(/\D/g, '') || q) ||
          c.plates?.some((p) => p.toLowerCase().includes(q)))
    );
  }, [customers, search, tierFilter]);

  const counts = useMemo(() => {
    const out: Record<CustomerTier, number> = { Platinum: 0, Gold: 0, Silver: 0, Bronze: 0 };
    for (const c of customers) out[c.tier] += 1;
    return out;
  }, [customers]);

  const lapsed = useMemo(
    () => customers.filter((c) => (daysSince(c.lastVisitAt) ?? 0) >= 30).length,
    [customers]
  );

  const exportCsv = () =>
    downloadCsv(
      `spillway-customers-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        filtered.map((c) => ({
          Name: c.name,
          Phone: c.phoneNumber,
          Tier: c.tier,
          Points: c.totalPoints ?? 0,
          Visits: c.totalVisits ?? 0,
          'Total spend (ZMW)': (c.totalSpend ?? 0).toFixed(2),
          Plates: (c.plates ?? []).join(' '),
          'Last visit': shortDate(c.lastVisitAt),
        }))
      )
    );

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Customers could not be loaded</AlertTitle>
        <AlertDescription className="text-xs">
          Deploy the latest Firestore rules (firebase deploy --only firestore:rules) so admins can read the
          customers collection.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {TIERS.map((tier) => (
          <Card
            key={tier}
            role="button"
            tabIndex={0}
            onClick={() => setTierFilter((t) => (t === tier ? 'All' : tier))}
            onKeyDown={(e) => e.key === 'Enter' && setTierFilter((t) => (t === tier ? 'All' : tier))}
            className={`cursor-pointer transition-colors hover:border-primary ${tierFilter === tier ? 'border-2 border-primary' : ''}`}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{tier}</CardTitle>
              <Trophy className={`h-4 w-4 ${tierStyles[tier].split(' ')[1]}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{isLoading ? '…' : counts[tier]}</div>
              <p className="text-xs text-muted-foreground">
                {tier === 'Bronze' ? `under ${TIER_THRESHOLDS.Silver}` : `${TIER_THRESHOLDS[tier]}+`} points
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Customers
              {tierFilter !== 'All' && <Badge variant="secondary">{tierFilter}</Badge>}
            </CardTitle>
            <CardDescription>
              {customers.length} customers · {lapsed} haven&apos;t been back in 30+ days. 1 point per K1 paid.
            </CardDescription>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Input
              placeholder="Search name, phone or plate…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:w-[240px]"
            />
            <Button variant="outline" size="icon" onClick={exportCsv} disabled={filtered.length === 0} aria-label="Download CSV">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Last visit</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {search || tierFilter !== 'All'
                      ? 'No customers match.'
                      : 'No customers yet. They appear after the first paid wash for a car with a phone number.'}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                filtered.map((c) => {
                  const away = daysSince(c.lastVisitAt);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        {c.plates && c.plates.length > 0 && (
                          <div className="text-xs text-muted-foreground">{c.plates.join(', ')}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{c.phoneNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={tierStyles[c.tier]}>
                          <Star className="mr-1 h-3 w-3" />
                          {c.tier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{c.totalPoints ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.totalVisits ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(c.totalSpend ?? 0)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {shortDate(c.lastVisitAt)}
                        {away !== null && away >= 30 && (
                          <Badge variant="secondary" className="ml-2 text-xs">{away}d ago</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="ghost" size="icon" aria-label={`WhatsApp ${c.name}`}>
                          <a
                            href={`https://wa.me/${c.phoneNumber}?text=${encodeURIComponent(
                              `Hi ${c.name}, thanks for being a Spillway regular! You have ${c.totalPoints ?? 0} loyalty points (${c.tier}).`
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </a>
                        </Button>
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
