"use client";

import React, { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import {
  BarChart2,
  Car,
  CircleDashed,
  HardHat,
  Home,
  Loader2,
  LogOut,
  Users,
  Wrench,
  Cloud,
  CloudOff,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Logo } from "./icons/logo";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { Badge } from "./ui/badge";

const adminNav = [
  { href: "/admin", icon: Home, label: "Dashboard" },
  { href: "/admin/services", icon: Wrench, label: "Services" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/dashboard", icon: HardHat, label: "Attendant View" },
];

const attendantNav = [
  { href: "/dashboard", icon: Car, label: "New Wash" },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoading } = useAuth();
  const { pendingTransactions, syncPendingTransactions, isSyncing } = useOfflineSync();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const navItems = user.role === 'Admin' ? adminNav : attendantNav;
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
            <div className="flex items-center gap-2">
                <Logo />
                <span className="text-lg font-semibold">SmartWash</span>
            </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  onClick={() => router.push(item.href)}
                  isActive={currentPath === item.href}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarImage src={`https://i.pravatar.cc/150?u=${user.id}`} />
              <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium truncate">{user.name}</span>
                <span className="text-xs text-sidebar-foreground/70 truncate">{user.role}</span>
            </div>
          </div>
          <SidebarMenuButton onClick={logout} >
            <LogOut />
            <span>Logout</span>
          </SidebarMenuButton>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center justify-between border-b bg-background px-4 lg:px-6">
            <SidebarTrigger className="md:hidden" />
            <div className="flex items-center gap-4 ml-auto">
                <Button variant="ghost" size="sm" onClick={syncPendingTransactions} disabled={isSyncing || pendingTransactions.length === 0}>
                    {isSyncing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        pendingTransactions.length > 0 ? <Cloud className="mr-2 h-4 w-4 text-primary" /> : <CloudOff className="mr-2 h-4 w-4" />
                    )}
                    <span>Sync</span>
                    {pendingTransactions.length > 0 && <Badge variant="destructive" className="ml-2">{pendingTransactions.length}</Badge>}
                </Button>
            </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
            {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
