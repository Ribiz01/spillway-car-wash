"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { users as initialUsers } from "@/lib/data";
import type { User, UserRole } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const userSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, "Name is required."),
  email: z.string().email("Invalid email address."),
  role: z.enum(["Admin", "Attendant"]),
  password: z.string().min(8, "Password must be at least 8 characters.").optional(),
});

export function UserManager() {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const { toast } = useToast();
  const { user: currentUser } = useAuth();


  const form = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
  });

  const handleDialogOpen = (user: User | null) => {
    setEditingUser(user);
    if (user) {
      form.reset({ ...user, password: "" });
    } else {
      form.reset({ name: "", email: "", role: "Attendant", password: "" });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = (data: z.infer<typeof userSchema>) => {
    if (editingUser) {
      // Edit
      const updatedUser = { ...editingUser, ...data };
      if (!data.password) {
        delete updatedUser.password;
      }
      setUsers(users.map(u => u.id === editingUser.id ? updatedUser : u));
      toast({ title: "User Updated", description: `${data.name} has been updated.` });
    } else {
      // Add
      const newUser: User = { id: `user-${Date.now()}`, ...data, password: data.password! };
      setUsers([...users, newUser]);
      toast({ title: "User Added", description: `${data.name} has been added.` });
    }
    setIsDialogOpen(false);
  };

  const handleDelete = (userId: string) => {
    if (userId === currentUser?.id) {
        toast({ title: "Action Forbidden", description: "You cannot delete your own account.", variant: "destructive" });
        return;
    }
    setUsers(users.filter(u => u.id !== userId));
    toast({ title: "User Deleted", variant: "destructive" });
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
              {users.map(user => (
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
                     <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(user.id)} disabled={user.id === currentUser?.id}>
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
            <DialogTitle>{editingUser ? "Edit User" : "Add New User"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Update the user's details and role." : "Enter the details for the new user."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input placeholder="John Doe" {...field} /></FormControl><FormMessage /></FormItem>
              )}/>
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="user@smartwash.com" {...field} /></FormControl><FormMessage /></FormItem>
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
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl><Input type="password" placeholder={editingUser ? "Leave blank to keep current" : "••••••••"} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}/>
              <DialogFooter>
                <Button type="submit">Save User</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
