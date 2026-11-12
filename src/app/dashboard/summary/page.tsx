import { AttendantSummary } from "@/components/dashboard/attendant-summary";

export default function AttendantSummaryPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Shift</h1>
        <p className="text-muted-foreground">
          Cash you have collected and the cars you have completed.
        </p>
      </div>
      <AttendantSummary />
    </div>
  );
}
