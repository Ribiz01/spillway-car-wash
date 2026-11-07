import { ReportsDashboard } from "@/components/admin/reports-dashboard";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">How the month went, compared with last month and the past year.</p>
      </div>
      <ReportsDashboard />
    </div>
  );
}
