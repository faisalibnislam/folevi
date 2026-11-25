import { notFound } from "next/navigation";
import { isServerEdition } from "@/lib/edition";
import { ServerAiView } from "@/components/admin/server/SettingsViews";

/** Folevi Server's admin panel only (docs/SELF_HOSTING_PLAN.md §6). */
export default function Page() {
  if (!isServerEdition()) notFound();
  return <ServerAiView />;
}
