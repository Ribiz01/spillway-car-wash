"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { services as initialServices } from "@/lib/data";
import type { Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const serviceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, "Service name is required."),
  price: z.coerce.number().min(0, "Price must be a positive number."),
});

export function ServiceManager() {
  const [services, setServices] = useState<Service[]>(initialServices);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof serviceSchema>>({
    resolver: zodResolver(serviceSchema),
    defaultValues: { name: "", price: 0 },
  });

  const handleDialogOpen = (service: Service | null) => {
    setEditingService(service);
    if (service) {
      form.reset(service);
    } else {
      form.reset({ name: "", price: 0 });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = (data: z.infer<typeof serviceSchema>) => {
    if (editingService) {
      // Edit
      setServices(services.map(s => s.id === editingService.id ? { ...s, ...data } : s));
       toast({ title: "Service Updated", description: `${data.name} has been updated.` });
    } else {
      // Add
      const newService: Service = { id: `svc-${Date.now()}`, ...data, price: Number(data.price) };
      setServices([...services, newService]);
       toast({ title: "Service Added", description: `${data.name} has been added.` });
    }
    setIsDialogOpen(false);
  };
  
  const handleDelete = (serviceId: string) => {
    // In a real app, you'd want a confirmation dialog
    setServices(services.filter(s => s.id !== serviceId));
    toast({ title: "Service Deleted", variant: "destructive" });
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
              {services.map(service => (
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
              ))}
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
                <Button type="submit">Save changes</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
