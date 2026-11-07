import { AttendantSummary } from "@/components/dashboard/attendant-summary";

export default function MyShiftPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Shift</h1>
        <p className="text-muted-foreground">What you took payment for and the cash you should be holding.</p>
      </div>
      <AttendantSummary />
    </div>
  );
}
