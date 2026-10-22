import { places } from "@/lib/auth/server";
import { withRequestLog } from "@/lib/server/log";

export const dynamic = "force-dynamic";

/** Signs this browser out of one account and leaves the others signed in (docs/MULTI_ACCOUNT_PLAN.md §9). */
export const POST = withRequestLog("api/places/sign-out", places.signOut);
