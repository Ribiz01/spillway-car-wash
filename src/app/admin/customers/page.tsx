import { CustomerList } from "@/components/admin/customer-list";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers &amp; Loyalty</h1>
        <p className="text-muted-foreground">
          Customers earn 1 point per ZMW paid. Silver from 100 points, Gold from 300, Platinum from 700.
        </p>
      </div>
      <CustomerList />
    </div>
  );
}
