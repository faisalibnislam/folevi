import { NextResponse } from "next/server";
import { DEV_COOKIE, createDevSessionCookie } from "@/lib/auth/dev";
import { isDevAuthEnabled } from "@/lib/env";
import { isSameOrigin } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

export async function POST(request: Request) {
  if (!isDevAuthEnabled()) return new NextResponse("Not found", { status: 404 });
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim().slice(0, 80) || email.split("@")[0] || "Friend";
  const returnTo = String(form.get("returnTo") ?? "/documents");
  if (!EMAIL_RE.test(email)) return NextResponse.redirect(new URL("/signin?error=invalid_email", request.url), 303);
  const cookie = await createDevSessionCookie({
    email,
    name,
    mfa: form.get("simulateMfaMissing") !== "on",
    verified: form.get("simulateUnverified") !== "on",
  });
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/documents";
  const res = NextResponse.redirect(new URL(safeReturn, request.url), 303);
  res.cookies.set(DEV_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
