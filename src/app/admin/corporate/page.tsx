import { CorporateWashes } from "@/components/admin/corporate-washes";
import { CorporateAccountManager } from "@/components/admin/corporate-account-manager";

export default function CorporatePage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Corporate Accounts</h1>
                <p className="text-muted-foreground">
                    Manage billed companies, chase what's owed, and record settlements.
                </p>
            </div>
            <CorporateWashes />
            <CorporateAccountManager />
        </div>
    );
}
