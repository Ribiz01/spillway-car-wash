import { Workflow } from "@/components/dashboard/workflow";
import { CashAvailable } from "@/components/dashboard/cash-available";
import { ActiveJobs } from "@/components/dashboard/active-jobs";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <CashAvailable />
      {/* Cars already on site come first: finishing a waiting car matters more
          than starting a new one. */}
      <ActiveJobs />
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-4">Check In a Car</h1>
        <Workflow />
      </div>
    </div>
  );
}
