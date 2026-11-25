import { NextResponse } from "next/server";
import { appUrl, marketingUrl } from "@/lib/env";
import { isServerEdition } from "@/lib/edition";
import { withRequestLog } from "@/lib/server/log";
import { isSameOrigin } from "@/lib/auth/origin";
import { handler } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * POST-only sign-out for forms (a cross-site link can't sign someone out). Ends the session on the
 * server through Better Auth, then sends the person to the marketing site. The app's own buttons sign
 * out client-side first so they can warn about unsynced changes.
 */
export const POST = withRequestLog("signout", async (request: Request) => {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const origin = new URL(appUrl()).origin;
  // Handled in-process by the same proxy that serves /api/auth/* (no network hop back to this app).
  const upstream = await handler
    .POST(
      new Request(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers: { cookie: request.headers.get("cookie") ?? "", origin, "content-type": "application/json" },
        body: "{}",
      }),
    )
    .catch(() => null);
  const res = NextResponse.redirect(isServerEdition() ? new URL("/signin?notice=signed_out", appUrl()) : new URL("/", marketingUrl()), 303);
  // Forward the cookie-clearing headers from Better Auth.
  for (const c of upstream?.headers.getSetCookie?.() ?? []) res.headers.append("set-cookie", c);
  return res;
});
