import { notFound } from "next/navigation";
import { isServerEdition } from "@/lib/edition";
import { RevenueView } from "@/components/admin/RevenueView";

export default function AdminRevenuePage() {
  // Folevi Server has no billing.
  if (isServerEdition()) notFound();
  return <RevenueView />;
}
