"use client";

import React, { useEffect } from "react";
import { useUser } from "@/firebase/auth/use-user";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart2,
  Briefcase,
  Calculator,
  Car,
  Home,
  Loader2,
  LogOut,
  MapPin,
  ReceiptText,
  Trophy,
  Users,
  Wallet,
  Wrench,
  HardHat,
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
import { Logo } from "./icons/logo";
import { SyncIndicator } from "./sync-indicator";

const adminNav = [
  { href: "/admin", icon: Home, label: "Dashboard" },
  { href: "/admin/reports", icon: BarChart2, label: "Reports" },
  { href: "/admin/cash-up", icon: Calculator, label: "Cash Up" },
  { href: "/admin/banking", icon: ReceiptText, label: "Banking & Expenses" },
  { href: "/admin/customers", icon: Trophy, label: "Customers" },
  { href: "/admin/corporate", icon: Briefcase, label: "Corporate" },
  { href: "/admin/locations", icon: MapPin, label: "Locations" },
  { href: "/admin/services", icon: Wrench, label: "Services" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/admin/washers", icon: Users, label: "Washers" },
  { href: "/dashboard", icon: HardHat, label: "Attendant View" },
];

const attendantNav = [
  { href: "/dashboard", icon: Car, label: "New Wash" },
  { href: "/dashboard/summary", icon: Wallet, label: "My Shift" },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoading } = useUser();
  const router = useRouter();
  const currentPath = usePathname() ?? '';

  const isAdminArea = currentPath.startsWith("/admin");
  const isAdmin = user?.profile?.role === "Admin";
  const isForbidden = !!user && isAdminArea && !isAdmin;

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    // Attendants must never land on an admin screen, even by typing the URL.
    if (isForbidden) {
      router.replace("/dashboard");
    }
  }, [isLoading, user, isForbidden, router]);

  if (isLoading || !user || isForbidden) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const navItems = user.profile?.role === 'Admin' ? adminNav : attendantNav;
  const fallbackInitial = (user.profile?.name || user.email || 'U').charAt(0).toUpperCase();
  
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
            <div className="flex items-center gap-2">
                <Logo />
                <span className="text-lg font-semibold">Spillway</span>
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
              <AvatarImage src={`https://i.pravatar.cc/150?u=${user.uid}`} />
              <AvatarFallback>{fallbackInitial}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium truncate">{user.profile?.name || user.email}</span>
                <span className="text-xs text-sidebar-foreground/70 truncate">
                  {user.profile?.role || 'User'}
                  {user.profile?.locationName ? ` · ${user.profile.locationName}` : ''}
                </span>
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
              {user.profile?.locationName && (
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span className="max-w-36 truncate sm:max-w-none">{user.profile.locationName}</span>
                </span>
              )}
              <SyncIndicator />
            </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
            {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
