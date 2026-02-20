'use client';

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { collection, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { firebaseConfig } from '@/firebase/config';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useUser } from "@/firebase/auth/use-user";
import type { UserProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Pencil, PlusCircle, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const userSchema = z.object({
  uid: z.string().optional(),
  name: z.string().min(2, "Name is required."),
  email: z.string().email("Invalid email address."),
  role: z.enum(["Admin", "Attendant"]),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
}).refine((data) => {
    // If it's a new user (no UID yet), passwords must be provided and match.
    if (!data.uid) {
        if (!data.password || data.password.length < 6) {
          return false;
        }
        if (data.password !== data.confirmPassword) {
          return false;
        }
    }
    return true;
}, {
    message: "Passwords are required, must be at least 6 characters, and must match.",
    path: ["confirmPassword"],
});


export function UserManager() {
  const firestore = useFirestore();
  const usersQuery = useMemoFirebase(() => {
      if (!firestore) return null;
      return collection(firestore, 'users');
  }, [firestore]);
  const { data: users, isLoading } = useCollection<UserProfile>(usersQuery);
  const { user: currentUser } = useUser();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingUser, setEditingUser] = useState<(UserProfile & { id: string }) | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      name: "",
      email: "",
      role: "Attendant",
      password: "",
      confirmPassword: "",
    },
  });

  const handleDialogOpen = (user: (UserProfile & { id: string }) | null) => {
    setEditingUser(user);
    if (user) {
      form.reset({
        uid: user.id,
        name: user.name || "",
        email: user.email || "",
        role: user.role || "Attendant",
        password: "",
        confirmPassword: "",
      });
    } else {
      form.reset({ uid: undefined, name: "", email: "", role: "Attendant", password: "", confirmPassword: "" });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: z.infer<typeof userSchema>) => {
    if (!firestore) return;
    setIsSubmitting(true);

    // EDITING EXISTING USER
    if (editingUser) {
        try {
            const userRef = doc(firestore, 'users', editingUser.id);
            await setDoc(userRef, {
                name: data.name,
                role: data.role,
            }, { merge: true });
            toast({ title: "User Updated", description: `${data.name} has been updated.` });
            setIsDialogOpen(false);
        } catch (error) {
            toast({ title: "Error", description: "Could not update user profile.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    }
    // CREATING NEW USER
    else {
        let tempApp;
        try {
            // Step 1: Create user in Firebase Auth using a temporary app instance
            const tempAppName = `createUser-${Date.now()}`;
            tempApp = initializeApp(firebaseConfig, tempAppName);
            const tempAuth = getAuth(tempApp);
            
            const userCredential = await createUserWithEmailAndPassword(tempAuth, data.email, data.password!);
            const newUserId = userCredential.user.uid;

            // Step 2: Create user profile in Firestore
            const userRef = doc(firestore, 'users', newUserId);
            await setDoc(userRef, {
                uid: newUserId,
                name: data.name,
                email: data.email,
                role: data.role,
            });
            
            toast({ title: "User Created", description: `${data.name} has been created successfully.` });
            setIsDialogOpen(false);
        } catch (error: any) {
            const errorCode = error.code;
            let errorMessage = "Could not create user.";
            if (errorCode === 'auth/email-already-in-use') {
                errorMessage = "This email address is already in use by another account.";
            } else if (errorCode === 'auth/weak-password') {
                errorMessage = "The password is too weak. It must be at least 6 characters long.";
            }
            toast({ title: "Error", description: errorMessage, variant: "destructive" });
        } finally {
            // Step 3: Clean up temporary app instance
            if (tempApp) {
                await deleteApp(tempApp);
            }
            setIsSubmitting(false);
        }
    }
  };


  const handleDelete = async (userToDelete: UserProfile) => {
    if (!firestore || !currentUser) return;
    if (userToDelete.uid === currentUser?.uid) {
        toast({ title: "Action Forbidden", description: "You cannot delete your own account.", variant: "destructive" });
        return;
    }
    // In a real app, you'd want to delete the user from Auth too, which requires a backend function.
    // For this client-side only implementation, we'll just delete the Firestore record.
    try {
        await deleteDoc(doc(firestore, 'users', userToDelete.uid));
        
        toast({ title: "User Profile Deleted", description: `Profile for ${userToDelete.name} deleted. Note: This does not delete the user from Firebase Authentication.`, variant: "destructive" });
    } catch (error) {
        toast({ title: "Error", description: "Could not delete user profile.", variant: "destructive" });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Users</CardTitle>
          <Button onClick={() => handleDialogOpen(null)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New User
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow key="loading">
                  <TableCell colSpan={4} className="text-center">
                    <Loader2 className="mx-auto my-4 h-6 w-6 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : users && users.length > 0 ? (
                users.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === 'Admin' ? 'destructive' : 'secondary'}>{user.role}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleDialogOpen(user)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                       <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(user)} disabled={user.uid === currentUser?.uid}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow key="empty">
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No users found.
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
            <DialogTitle>{editingUser ? "Edit User" : "Add New User"}</DialogTitle>
            <DialogDescription>
              {editingUser ? `Update profile for ${editingUser.name}.` : "Create a new user account and profile."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input placeholder="John Doe" {...field} /></FormControl><FormMessage /></FormItem>
              )}/>
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="user@spillway.com" {...field} disabled={!!editingUser} /></FormControl><FormMessage /></FormItem>
              )}/>
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="Attendant">Attendant</SelectItem>
                      <SelectItem value="Admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}/>
              {!editingUser && (
                <>
                  <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>
                  )}/>
                  <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                    <FormItem><FormLabel>Confirm Password</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>
                  )}/>
                </>
              )}
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                   {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingUser ? "Save Changes" : "Create User"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
