"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { collection, doc, setDoc, deleteDoc, addDoc } from "firebase/firestore";
import { useFirestore, useMemoFirebase } from "@/firebase";
import { useCollection } from "@/firebase/firestore/use-collection";
import { useUser } from "@/firebase/auth/use-user";
import type { Washer } from "@/lib/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pencil, PlusCircle, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const washerSchema = z.object({
  name: z.string().min(2, "Name is required."),
});

export function WasherManager() {
  const firestore = useFirestore();
  const washersQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, "washers");
  }, [firestore]);
  const { data: washers, isLoading } = useCollection<Washer>(washersQuery);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingWasher, setEditingWasher] = useState<Washer | null>(null);
  const [washerToDelete, setWasherToDelete] = useState<Washer | null>(null);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof washerSchema>>({
    resolver: zodResolver(washerSchema),
    defaultValues: {
      name: "",
    },
  });

  const handleDialogOpen = (washer: Washer | null) => {
    setEditingWasher(washer);
    if (washer) {
      form.reset({
        name: washer.name,
      });
    } else {
      form.reset({ name: "" });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: z.infer<typeof washerSchema>) => {
    if (!firestore) return;
    setIsSubmitting(true);

    try {
      if (editingWasher) {
        const washerRef = doc(firestore, "washers", editingWasher.id);
        await setDoc(washerRef, { name: data.name }, { merge: true });
        toast({ title: "Washer Updated", description: `${data.name} has been updated.` });
      } else {
        await addDoc(collection(firestore, "washers"), { name: data.name });
        toast({ title: "Washer Created", description: `${data.name} has been added successfully.` });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: "Error", description: "Could not save washer.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!washerToDelete || !firestore) return;

    try {
      await deleteDoc(doc(firestore, "washers", washerToDelete.id));
      toast({ title: "Washer Deleted", description: `Washer ${washerToDelete.name} removed.` });
    } catch (error) {
      toast({ title: "Error", description: "Could not delete washer.", variant: "destructive" });
    } finally {
      setIsDeleteAlertOpen(false);
      setWasherToDelete(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Washers</CardTitle>
          <Button onClick={() => handleDialogOpen(null)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Washer
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow key="loading">
                  <TableCell colSpan={2} className="text-center">
                    <Loader2 className="mx-auto my-4 h-6 w-6 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : washers && washers.length > 0 ? (
                washers.map((washer) => (
                  <TableRow key={washer.id}>
                    <TableCell className="font-medium">{washer.name}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleDialogOpen(washer)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => {
                          setWasherToDelete(washer);
                          setIsDeleteAlertOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow key="empty">
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    No washers found.
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
            <DialogTitle>{editingWasher ? "Edit Washer" : "Add New Washer"}</DialogTitle>
            <DialogDescription>
              {editingWasher ? `Update details for ${editingWasher.name}.` : "Add a new washer to the system."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingWasher ? "Save Changes" : "Add Washer"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete this washer from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setWasherToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className={cn(buttonVariants({ variant: "destructive" }))}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
