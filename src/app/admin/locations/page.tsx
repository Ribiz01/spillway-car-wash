import { LocationManager } from "@/components/admin/location-manager";

export default function LocationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
        <p className="text-muted-foreground">
          Your branches. Assign staff to one under Users and their washes are tagged with it.
        </p>
      </div>
      <LocationManager />
    </div>
  );
}
