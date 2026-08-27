import { CashUp } from "@/components/admin/cash-up";

export default function CashUpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daily Cash Up</h1>
        <p className="text-muted-foreground">
          Reconcile the drawer against recorded washes, then close the day.
        </p>
      </div>
      <CashUp />
    </div>
  );
}
