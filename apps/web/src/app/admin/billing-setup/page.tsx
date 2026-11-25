import { notFound } from "next/navigation";
import { isServerEdition } from "@/lib/edition";
import { BillingSetupView } from "@/components/admin/BillingSetupView";

export default function AdminBillingSetupPage() {
  // Folevi Server has no billing.
  if (isServerEdition()) notFound();
  return <BillingSetupView />;
}
