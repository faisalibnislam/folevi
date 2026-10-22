import { places } from "@/lib/auth/server";
import { withRequestLog } from "@/lib/server/log";

export const dynamic = "force-dynamic";

/** The accounts this browser is signed in to (docs/MULTI_ACCOUNT_PLAN.md §2.1): names and emails, never tokens. */
export const GET = withRequestLog("api/places", places.list);
