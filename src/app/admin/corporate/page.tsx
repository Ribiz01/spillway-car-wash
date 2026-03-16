import { CorporateWashes } from "@/components/admin/corporate-washes";

export default function CorporatePage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Corporate Washes</h1>
                <p className="text-muted-foreground">View all transactions billed to corporate accounts.</p>
            </div>
            <CorporateWashes />
        </div>
    );
}
