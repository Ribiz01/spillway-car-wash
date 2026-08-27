import { DashboardLayout } from "@/components/dashboard-layout";

export default function AttendantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
