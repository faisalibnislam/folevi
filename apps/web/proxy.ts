import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth/auth0";

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com";
const marketingHost = new URL(MARKETING_URL).host;
const appHost = new URL(APP_URL).host;

// Paths that only exist on the marketing site.
const MARKETING_ONLY = /^\/($|mac$|mac\/|security|pricing|changelog|privacy|terms|docs|status)/;
// Paths that only exist on the product host (app + admin + auth + share pages).
const APP_ONLY =
  /^\/(documents|d\/|tasks|calendar|daily|shared|templates|starred|archive|trash|unsorted|folders|tags|settings|help|onboarding|invite|admin|signin|signup|verify-email|signout|auth\/|s\/|api\/|dev-auth|offline)/;

function isAppPath(pathname: string): boolean {
  return APP_ONLY.test(pathname);
}

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const pathname = url.pathname;

  // Canonical marketing host: www → apex.
  if (host === `www.${marketingHost}`) {
    return NextResponse.redirect(new URL(`${pathname}${url.search}`, MARKETING_URL), 308);
  }

  if (host === appHost) {
    if (pathname === "/") return NextResponse.redirect(new URL("/documents", request.url));
    if (MARKETING_ONLY.test(pathname) && !isAppPath(pathname)) {
      return NextResponse.redirect(new URL(`${pathname}${url.search}`, MARKETING_URL));
    }
  } else if (host === marketingHost && isAppPath(pathname) && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL(`${pathname}${url.search}`, APP_URL));
  }

  // Auth0 handles /auth/login, /auth/callback, /auth/logout and rolls the session cookie.
  if (auth0 && host !== marketingHost) {
    const response = await auth0.middleware(request);
    if (pathname.startsWith("/auth/")) return response;
    return response;
  }
  if (pathname.startsWith("/auth/")) {
    return NextResponse.redirect(new URL("/signin?error=auth_not_configured", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|sitemap.xml|robots.txt|manifest.webmanifest|sw.js|marketing/|fonts/).*)"],
};
