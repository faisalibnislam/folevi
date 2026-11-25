import { DashboardView } from "@/components/admin/DashboardView";
import { ServerOverviewView } from "@/components/admin/server/OverviewView";
import { isServerEdition } from "@/lib/edition";

export default function AdminDashboardPage() {
  // Folevi Server: the server's own overview (docs/SELF_HOSTING_PLAN.md §6).
  return isServerEdition() ? <ServerOverviewView /> : <DashboardView />;
}
