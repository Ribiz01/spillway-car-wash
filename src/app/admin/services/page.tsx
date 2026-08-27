import { ServiceManager } from "@/components/admin/service-manager";

export default function ServicesPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Manage Services</h1>
                <p className="text-muted-foreground">Add, edit, or remove car wash services and pricing.</p>
            </div>
            <ServiceManager />
        </div>
    );
}
