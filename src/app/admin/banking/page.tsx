import { ExpensesBanking } from "@/components/admin/expenses-banking";

export default function BankingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Expenses &amp; Banking</h1>
        <p className="text-muted-foreground">Record what you spend and see how much cash is still to bank.</p>
      </div>
      <ExpensesBanking />
    </div>
  );
}
