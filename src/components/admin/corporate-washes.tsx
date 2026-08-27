"use client";

import { useMemo, useState } from 'react';
import { collection, doc, query, where, writeBatch } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useUser } from '@/firebase/auth/use-user';
import type { CorporateAccount, Settlement, SettlementMethod, Transaction } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { corporateOutstanding } from '@/lib/payments';
import { isReversed } from '@/lib/transactions';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { Briefcase, Download, Loader2, Receipt, AlertTriangle } from 'lucide-react';

interface AccountGroup {
  accountId: string;
  accountName: string;
  outstanding: Transaction[];
  outstandingTotal: number;
  settledTotal: number;
  creditLimit: number;
  overLimit: boolean;
}

export function CorporateWashes() {
  const firestore = useFirestore();
  const { user, isLoading: isUserLoading } = useUser();
  const { toast } = useToast();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [settlingGroup, setSettlingGroup] = useState<AccountGroup | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [method, setMethod] = useState<SettlementMethod>('Bank Transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    // array-contains on a single field uses Firestore's automatic index. Adding
    // orderBy here would demand a composite index, so sorting happens below.
    return query(
      collection(firestore, 'transactions'),
      where('paymentMethods', 'array-contains', 'Corporate Account')
    );
  }, [firestore, user]);

  const accountsQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'corporateAccounts') : null),
    [firestore]
  );

  const { data: transactions, isLoading: areTransactionsLoading, error: transactionsError } =
    useCollection<Transaction>(transactionsQuery);
  const { data: accounts, error: accountsError } = useCollection<CorporateAccount>(accountsQuery);
  const isLoading = isUserLoading || areTransactionsLoading;
  const loadError = transactionsError || accountsError;

  /** Group unpaid washes by company so a bill can be settled in one action. */
  const groups: AccountGroup[] = useMemo(() => {
    if (!transactions) return [];
    const byAccount = new Map<string, AccountGroup>();

    // Cancelled and voided washes are not owed and were never collected, so they
    // belong in neither bucket. Without this filter a voided wash would fall
    // through to `settledTotal` and read as money the company had paid.
    const ordered = [...transactions]
      .filter((t) => !isReversed(t))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    for (const t of ordered) {
      // Legacy rows have no account attached; bucket them so they're still visible.
      const id = t.corporateAccountId ?? '__unassigned__';
      const name = t.corporateAccountName ?? 'Unassigned (legacy)';

      if (!byAccount.has(id)) {
        const account = accounts?.find((a) => a.id === id);
        byAccount.set(id, {
          accountId: id,
          accountName: account?.name ?? name,
          outstanding: [],
          outstandingTotal: 0,
          settledTotal: 0,
          creditLimit: account?.creditLimit ?? 0,
          overLimit: false,
        });
      }

      const group = byAccount.get(id)!;
      // Only the portion actually billed to the account is owed. A wash paid
      // half in cash and half on account owes half — charging the company the
      // full totalAmount would overstate every statement.
      const owed = corporateOutstanding(t);
      if (t.status === 'Pending Payment') {
        group.outstanding.push(t);
        group.outstandingTotal += owed;
      } else {
        group.settledTotal += owed;
      }
    }

    for (const g of byAccount.values()) {
      g.overLimit = g.creditLimit > 0 && g.outstandingTotal > g.creditLimit;
    }

    return [...byAccount.values()].sort((a, b) => b.outstandingTotal - a.outstandingTotal);
  }, [transactions, accounts]);

  const totalOutstanding = groups.reduce((acc, g) => acc + g.outstandingTotal, 0);

  const selectedForGroup = (group: AccountGroup) =>
    group.outstanding.filter((t) => selectedIds.has(t.id));

  const selectedTotal = settlingGroup
    ? selectedForGroup(settlingGroup).reduce((acc, t) => acc + corporateOutstanding(t), 0)
    : 0;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = (group: AccountGroup) => {
    const allSelected = group.outstanding.every((t) => selectedIds.has(t.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const t of group.outstanding) {
        allSelected ? next.delete(t.id) : next.add(t.id);
      }
      return next;
    });
  };

  const openSettleDialog = (group: AccountGroup) => {
    // Default to settling the whole bill if nothing was ticked.
    if (selectedForGroup(group).length === 0) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        group.outstanding.forEach((t) => next.add(t.id));
        return next;
      });
    }
    setMethod('Bank Transfer');
    setReference('');
    setNote('');
    setSettlingGroup(group);
  };

  const recordSettlement = async () => {
    if (!firestore || !user || !settlingGroup) return;
    const toSettle = selectedForGroup(settlingGroup);
    if (toSettle.length === 0) return;

    setIsSubmitting(true);
    const settlementRef = doc(collection(firestore, 'settlements'));
    const settledAt = new Date().toISOString();
    const amount = toSettle.reduce((acc, t) => acc + corporateOutstanding(t), 0);

    const settlement: Omit<Settlement, 'id'> = {
      corporateAccountId: settlingGroup.accountId,
      corporateAccountName: settlingGroup.accountName,
      transactionIds: toSettle.map((t) => t.id),
      amount,
      method,
      reference: reference.trim(),
      note: note.trim(),
      settledAt,
      settledByUid: user.uid,
      settledByName: user.profile?.name || user.email || 'Unknown',
    };

    try {
      // One atomic batch: either the settlement AND every wash flips to paid,
      // or nothing does. A partial write here would corrupt the ledger.
      const batch = writeBatch(firestore);
      batch.set(settlementRef, settlement);
      for (const t of toSettle) {
        batch.update(doc(firestore, 'transactions', t.id), {
          status: 'Completed',
          settlementId: settlementRef.id,
          settledAt,
        });
      }
      await batch.commit();

      toast({
        title: 'Settlement Recorded',
        description: `${formatCurrency(amount)} received from ${settlingGroup.accountName}.`,
      });
      setSelectedIds(new Set());
      setSettlingGroup(null);
    } catch (error: any) {
      toast({
        title: 'Settlement Failed',
        description: error.message || 'Nothing was changed. Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportStatement = (group: AccountGroup) => {
    const rows = group.outstanding.map((t) => ({
      Date: new Date(t.timestamp).toLocaleDateString('en-ZM'),
      'Receipt ID': t.id,
      'License Plate': t.licensePlate,
      Services: t.services.map((s) => s.name).join('; '),
      Amount: corporateOutstanding(t).toFixed(2),
      Attendant: t.completedByName ?? t.userName ?? t.userId,
    }));
    rows.push({
      Date: '',
      'Receipt ID': '',
      'License Plate': '',
      Services: 'TOTAL DUE',
      Amount: group.outstandingTotal.toFixed(2),
      Attendant: '',
    });
    const slug = group.accountName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(`statement-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError) {
    // Most often a missing composite index on
    // (payment.method ASC, timestamp DESC) rather than a rules problem.
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load corporate washes</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Nothing here is safe to bill from until this loads. Deploy the Firestore
            indexes and rules, then reload:
          </p>
          <code className="block font-mono text-xs">
            firebase deploy --only firestore
          </code>
          <p className="text-xs opacity-80">{loadError.message}</p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center gap-4 space-y-0">
            <Briefcase className="size-8 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
              <p className="text-2xl font-bold">{formatCurrency(totalOutstanding)}</p>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-4 space-y-0">
            <Receipt className="size-8 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm font-medium">Unpaid Washes</CardTitle>
              <p className="text-2xl font-bold">
                {groups.reduce((acc, g) => acc + g.outstanding.length, 0)}
              </p>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-4 space-y-0">
            <AlertTriangle className="size-8 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm font-medium">Over Credit Limit</CardTitle>
              <p className="text-2xl font-bold">{groups.filter((g) => g.overLimit).length}</p>
            </div>
          </CardHeader>
        </Card>
      </div>

      {groups.length === 0 ? (
        <Alert>
          <Briefcase className="h-4 w-4" />
          <AlertTitle>No Corporate Washes</AlertTitle>
          <AlertDescription>There are no transactions billed to a corporate account yet.</AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Outstanding by Company</CardTitle>
            <CardDescription>
              Tick the washes a company has paid for, then record the settlement. Everything is
              marked paid in one atomic write.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {groups.map((group) => (
                <AccordionItem key={group.accountId} value={group.accountId}>
                  <AccordionTrigger>
                    <div className="flex flex-1 items-center justify-between pr-4">
                      <div className="flex items-center gap-2 text-left">
                        <span className="font-medium">{group.accountName}</span>
                        {group.overLimit && (
                          <Badge variant="destructive" className="text-[10px]">Over limit</Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-bold">{formatCurrency(group.outstandingTotal)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {group.outstanding.length} unpaid
                        </span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    {group.overLimit && (
                      <Alert variant="destructive" className="mb-4">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Credit limit exceeded</AlertTitle>
                        <AlertDescription>
                          Outstanding {formatCurrency(group.outstandingTotal)} against a limit of{' '}
                          {formatCurrency(group.creditLimit)}. Consider pausing further billing.
                        </AlertDescription>
                      </Alert>
                    )}

                    {group.outstanding.length === 0 ? (
                      <p className="py-4 text-sm text-muted-foreground">
                        Fully settled. {formatCurrency(group.settledTotal)} paid to date.
                      </p>
                    ) : (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[40px]">
                                <Checkbox
                                  checked={group.outstanding.every((t) => selectedIds.has(t.id))}
                                  onCheckedChange={() => toggleAll(group)}
                                  aria-label={`Select all washes for ${group.accountName}`}
                                />
                              </TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Plate</TableHead>
                              <TableHead>Services</TableHead>
                              <TableHead>Attendant</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.outstanding.map((t) => (
                              <TableRow key={t.id} data-state={selectedIds.has(t.id) ? 'selected' : undefined}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedIds.has(t.id)}
                                    onCheckedChange={() => toggle(t.id)}
                                    aria-label={`Select wash ${t.licensePlate}`}
                                  />
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-sm">
                                  {new Date(t.timestamp).toLocaleDateString('en-ZM')}
                                </TableCell>
                                <TableCell className="font-medium">{t.licensePlate}</TableCell>
                                <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                                  {t.services.map((s) => s.name).join(', ')}
                                </TableCell>
                                <TableCell className="text-sm">{t.userName ?? '—'}</TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(corporateOutstanding(t))}
                                  {corporateOutstanding(t) !== t.totalAmount && (
                                    <span className="block text-xs text-muted-foreground">
                                      of {formatCurrency(t.totalAmount)} wash
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => exportStatement(group)}>
                            <Download className="mr-2 h-4 w-4" /> Export Statement
                          </Button>
                          <Button size="sm" onClick={() => openSettleDialog(group)}>
                            <Receipt className="mr-2 h-4 w-4" /> Record Settlement
                          </Button>
                        </div>
                      </>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!settlingGroup} onOpenChange={(open) => !open && setSettlingGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Settlement</DialogTitle>
            <DialogDescription>
              {settlingGroup?.accountName} — {settlingGroup ? selectedForGroup(settlingGroup).length : 0} wash(es)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-4 text-center">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount Received</p>
              <p className="text-3xl font-bold">{formatCurrency(selectedTotal)}</p>
            </div>

            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as SettlementMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Mobile Money">Mobile Money</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="settlement-ref">Reference</Label>
              <Input
                id="settlement-ref"
                placeholder="Bank ref, cheque no. or MoMo ID"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="settlement-note">Note (optional)</Label>
              <Textarea
                id="settlement-note"
                placeholder="Anything worth recording about this payment"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlingGroup(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={recordSettlement} disabled={isSubmitting || selectedTotal === 0}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm {formatCurrency(selectedTotal)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
