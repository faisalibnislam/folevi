import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/server/log";
import { devMailboxAvailable, readDevMailbox } from "@/lib/devMailbox";

export const dynamic = "force-dynamic";

/** Development only: identity emails (verification, password reset) captured instead of being sent. */
export const GET = withRequestLog("api/dev/mailbox", async (request: Request) => {
  if (!devMailboxAvailable()) return new NextResponse("Not found", { status: 404 });
  const to = new URL(request.url).searchParams.get("to") ?? undefined;
  const messages = await readDevMailbox(to);
  return NextResponse.json({ messages: messages ?? [] }, { headers: { "cache-control": "no-store" } });
});
