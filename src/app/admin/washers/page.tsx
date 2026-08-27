"use strict";

import { WasherManager } from "@/components/admin/washer-manager";

export default function WashersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Washer Management</h1>
        <p className="text-muted-foreground">Add, edit, and remove car washers.</p>
      </div>
      <WasherManager />
    </div>
  );
}
