import { CustomerList } from "@/components/admin/customer-list";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers &amp; Loyalty</h1>
        <p className="text-muted-foreground">Regulars, their points and tiers. Customers earn 1 point per car washed.</p>
      </div>
      <CustomerList />
    </div>
  );
}
