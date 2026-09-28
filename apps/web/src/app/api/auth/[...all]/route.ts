import { handler } from "@/lib/auth/server";
import { withRequestLog } from "@/lib/server/log";

export const dynamic = "force-dynamic";

export const GET = withRequestLog("api/auth", handler.GET);
export const POST = withRequestLog("api/auth", handler.POST);
