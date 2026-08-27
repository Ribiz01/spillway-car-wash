'use client';

import { useMemo } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useUser } from '@/firebase/auth/use-user';
import type { CashUp as CashUpRecord, Transaction } from '@/lib/types';
import { formatCurrency, todayIso, startOfLocalDayIso, endOfLocalDayIso } from '@/lib/utils';
import { amountByMethod } from '@/lib/payments';
import { isActive, isRevenue } from '@/lib/transactions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Banknote, Lock, TriangleAlert } from 'lucide-react';

/**
 * Read-only view of what the till should be holding right now, for attendants.
 *
 * Deliberately NOT the admin Cash Up screen: there is no counting, no closing,
 * no variance and no export here. It answers one question — "how much cash
 * should be in the drawer?" — so the attendant on shift can spot a discrepancy
 * long before an admin reconciles at the end of the day.
 */
export function CashAvailable() {
  const firestore = useFirestore();
  const { user } = useUser();
  const date = todayIso();

  // Range on a single field (timestamp) only, so this is served by the
  // automatic single-field index — it needs no composite index deployed.
  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, 'transactions'),
      where('timestamp', '>=', startOfLocalDayIso(date)),
      where('timestamp', '<=', endOfLocalDayIso(date))
    );
  }, [firestore, user, date]);

  const { data: transactions, isLoading, error } = useCollection<Transaction>(transactionsQuery);

  const cashUpRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, 'cashups', date) : null),
    [firestore, user, date]
  );
  // A failure here is non-fatal: it only costs the "day closed" badge, so it is
  // intentionally not folded into the error state below.
  const { data: closed } = useDoc<CashUpRecord>(cashUpRef);

  const totals = useMemo(() => {
    const rows = transactions ?? [];
    // Cars still being washed have no payment yet and are not takings.
    const paid = rows.filter(isRevenue);

    // Cash ONLY. Mobile Money and corporate billing never enter the drawer, so
    // showing them here just invites someone to count against the wrong number.
    // With split payments this sums the cash PORTION of each wash, not its total.
    const cashOf = (t: (typeof paid)[number]) => amountByMethod(t, 'Cash');

    return {
      cash: paid.reduce((acc, t) => acc + cashOf(t), 0),
      count: paid.filter((t) => cashOf(t) > 0).length,
      onSite: rows.filter(isActive).length,
      // Attributed to whoever took the payment, not whoever checked the car in:
      // that is the person actually holding the cash.
      mine: paid
        .filter((t) => (t.completedByUid ?? t.userId) === user?.uid)
        .reduce((acc, t) => acc + cashOf(t), 0),
      myCount: paid.filter(
        (t) => (t.completedByUid ?? t.userId) === user?.uid && cashOf(t) > 0
      ).length,
    };
  }, [transactions, user?.uid]);

  if (isLoading) {
    return <Skeleton className="h-[132px] w-full" />;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Cash total unavailable</AlertTitle>
        <AlertDescription className="text-xs">
          Today&apos;s takings could not be loaded, so no figure is shown rather than a
          misleading zero. You can still record washes as normal.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Cash in Drawer</CardTitle>
            <CardDescription>
              {totals.count} cash wash{totals.count === 1 ? '' : 'es'} today
              {totals.onSite > 0 && `, ${totals.onSite} still on site`}
            </CardDescription>
          </div>
          {closed && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" /> Day closed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Banknote className="h-3.5 w-3.5" /> Cash taken today
          </div>
          <p className="mt-1 text-3xl font-bold tabular-nums">{formatCurrency(totals.cash)}</p>
        </div>

        <p className="text-xs text-muted-foreground">
          This is physical cash only — mobile money and account washes are not included.
          You took {formatCurrency(totals.mine)} of it across {totals.myCount} wash
          {totals.myCount === 1 ? '' : 'es'}.
        </p>
      </CardContent>
    </Card>
  );
}
