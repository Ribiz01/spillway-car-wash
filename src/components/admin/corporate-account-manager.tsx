'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { collection, doc, setDoc } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import type { CorporateAccount } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Pencil, PlusCircle, Building2 } from 'lucide-react';

const accountSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Company name is required.'),
  contactName: z.string().optional(),
  phoneNumber: z.string().optional(),
  email: z.string().email('Invalid email address.').optional().or(z.literal('')),
  creditLimit: z.coerce.number().min(0, 'Cannot be negative.').optional(),
  active: z.boolean(),
});

export function CorporateAccountManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editing, setEditing] = useState<CorporateAccount | null>(null);

  const accountsQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'corporateAccounts') : null),
    [firestore]
  );
  const { data: accounts, isLoading } = useCollection<CorporateAccount>(accountsQuery);

  const form = useForm<z.infer<typeof accountSchema>>({
    resolver: zodResolver(accountSchema),
    defaultValues: { name: '', contactName: '', phoneNumber: '', email: '', creditLimit: 0, active: true },
  });

  const openDialog = (account: CorporateAccount | null) => {
    setEditing(account);
    form.reset(
      account
        ? {
            id: account.id,
            name: account.name,
            contactName: account.contactName ?? '',
            phoneNumber: account.phoneNumber ?? '',
            email: account.email ?? '',
            creditLimit: account.creditLimit ?? 0,
            active: account.active,
          }
        : { id: undefined, name: '', contactName: '', phoneNumber: '', email: '', creditLimit: 0, active: true }
    );
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: z.infer<typeof accountSchema>) => {
    if (!firestore) return;
    setIsSubmitting(true);
    try {
      const ref = editing
        ? doc(firestore, 'corporateAccounts', editing.id)
        : doc(collection(firestore, 'corporateAccounts'));

      await setDoc(
        ref,
        {
          name: data.name.trim(),
          contactName: data.contactName?.trim() || '',
          phoneNumber: data.phoneNumber?.trim() || '',
          email: data.email?.trim() || '',
          creditLimit: data.creditLimit ?? 0,
          active: data.active,
          ...(editing ? {} : { createdAt: new Date().toISOString() }),
        },
        { merge: true }
      );

      toast({ title: editing ? 'Account Updated' : 'Account Created', description: data.name });
      setIsDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Could not save the account.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Corporate Accounts</CardTitle>
          <CardDescription>Companies that can be billed after the wash.</CardDescription>
        </div>
        <Button size="sm" onClick={() => openDialog(null)}>
          <PlusCircle className="mr-2 h-4 w-4" /> Add Account
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : accounts && accounts.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Credit Limit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {a.contactName || '—'}
                    {a.phoneNumber ? ` · ${a.phoneNumber}` : ''}
                  </TableCell>
                  <TableCell>{a.creditLimit ? formatCurrency(a.creditLimit) : 'No limit'}</TableCell>
                  <TableCell>
                    <Badge variant={a.active ? 'secondary' : 'outline'}>{a.active ? 'Active' : 'Inactive'}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => openDialog(a)}>
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Edit {a.name}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No corporate accounts yet. Add one so attendants can bill washes to a company.
            </p>
          </div>
        )}
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Account' : 'New Corporate Account'}</DialogTitle>
            <DialogDescription>
              Attendants will see active accounts in the payment step.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <div className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Zambeef Products PLC" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="contactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Person</FormLabel>
                    <FormControl><Input placeholder="Optional" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl><Input placeholder="260977123456" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input placeholder="accounts@company.co.zm" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="creditLimit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Credit Limit (ZMW)</FormLabel>
                  <FormControl><Input type="number" min={0} step={50} {...field} /></FormControl>
                  <FormDescription>0 means no limit. Shown as a warning, not a hard block.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="active" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel>Active</FormLabel>
                    <FormDescription>Inactive accounts are hidden from attendants.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />
            </div>
          </Form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={form.handleSubmit(onSubmit)} disabled={isSubmitting}>
              {editing ? 'Save Changes' : 'Create Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
