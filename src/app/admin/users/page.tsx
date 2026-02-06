import { UserManager } from "@/components/admin/user-manager";

export default function UsersPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Manage Users</h1>
                <p className="text-muted-foreground">Add, edit, or remove system users.</p>
            </div>
            <UserManager />
        </div>
    );
}
