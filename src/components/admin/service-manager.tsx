"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { collection, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import type { Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { Pencil, PlusCircle, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const serviceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, "Service name is required."),
  price: z.coerce.number().min(0, "Price must be a positive number."),
});

export function ServiceManager() {
  const firestore = useFirestore();
  const servicesQuery = useMemoFirebase(() => {
      if (!firestore) return null;
      return collection(firestore, 'services');
  }, [firestore]);
  const { data: services, isLoading } = useCollection<Service>(servicesQuery);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof serviceSchema>>({
    resolver: zodResolver(serviceSchema),
    defaultValues: { name: "", price: 0 },
  });

  const handleDialogOpen = (service: Service | null) => {
    setEditingService(service);
    if (service) {
      form.reset({
        id: service.id,
        name: service.name || "",
        price: service.price ?? 0,
      });
    } else {
      form.reset({ name: "", price: 0 });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: z.infer<typeof serviceSchema>) => {
    if (!firestore) return;
    setIsSubmitting(true);
    try {
      if (editingService) {
        const serviceRef = doc(firestore, 'services', editingService.id);
        await updateDoc(serviceRef, { name: data.name, price: data.price });
        toast({ title: "Service Updated", description: `${data.name} has been updated.` });
      } else {
        await addDoc(collection(firestore, 'services'), { name: data.name, price: data.price });
        toast({ title: "Service Added", description: `${data.name} has been added.` });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: "Error", description: "Could not save service.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleDelete = async (serviceId: string) => {
    if (!firestore) return;
    // In a real app, you'd want a confirmation dialog
    try {
        await deleteDoc(doc(firestore, 'services', serviceId));
        toast({ title: "Service Deleted", variant: "destructive" });
    } catch (error) {
        toast({ title: "Error", description: "Could not delete service.", variant: "destructive" });
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Services</CardTitle>
          <Button onClick={() => handleDialogOpen(null)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Service
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow key="loading">
                  <TableCell colSpan={3} className="text-center">
                    <Loader2 className="mx-auto my-4 h-6 w-6 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : services && services.length > 0 ? (
                services.map(service => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">{service.name}</TableCell>
                    <TableCell>{formatCurrency(service.price)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleDialogOpen(service)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(service.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow key="empty">
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No services found. Add one to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingService ? "Edit Service" : "Add New Service"}</DialogTitle>
            <DialogDescription>
              {editingService ? "Update the details for this service." : "Enter the details for the new service."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Exterior Wash" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (ZMW)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
