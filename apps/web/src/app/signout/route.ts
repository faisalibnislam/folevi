import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { DEV_COOKIE } from "@/lib/auth/dev";
import { MARKETING_URL } from "@/lib/env";
import { isSameOrigin } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

/** POST-only so a cross-site link can't sign someone out. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  if (auth0 && (await auth0.getSession())) {
    return NextResponse.redirect(new URL("/auth/logout", request.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", MARKETING_URL), 303);
  res.cookies.delete(DEV_COOKIE);
  return res;
}
