import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";
import { themeBootScriptHash } from "@/lib/theme/bootScript";
import { SIGNED_IN_HINT, hintCookie, hintDomain } from "@/lib/auth/signedInHint";
import { SIGNED_IN_PATH, signedInCheckScriptHash } from "@/lib/auth/signedInCheck";

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com";
const marketingHost = new URL(MARKETING_URL).host;
const appHost = new URL(APP_URL).host;

// Paths that only exist on the marketing site.
const MARKETING_ONLY = /^\/($|mac$|mac\/|features|template-gallery|security|pricing|changelog|privacy|terms|docs|status|support|compare|blog)/;
// Paths that only exist on the product host (app + admin + auth + share pages).
const APP_ONLY =
  /^\/(documents|notes|d\/|ai(?:\/|$)|graph(?:\/|$)|tasks|calendar|review(?:\/|$)|changes(?:\/|$)|daily|shared|templates|starred|archive|trash|drafts|unsorted|folders|tags|settings|help|onboarding|invite|share-invite|share(?:$|\/)|share-target$|place-sync$|admin|signin|signup|connect|verify-email|forgot-password|reset-password|two-factor|signout|s\/|api\/|offline|dev\/|oauth\/|mcp(?:\/|$)|native\/callback$|\.well-known\/oauth-|\.well-known\/assetlinks\.json$)/;

function isAppPath(pathname: string): boolean {
  return APP_ONLY.test(pathname);
}

// Routes that always render per request (product views, admin, sign-in flows, share pages). These get a
// nonce-based CSP without 'unsafe-inline'. Statically prerendered pages keep next.config's static policy,
// because they have no per-request nonce to put on Next's inline scripts.
const NONCE_ROUTES =
  /^\/(documents|notes|d\/|ai(?:\/|$)|graph(?:\/|$)|tasks|calendar|review(?:\/|$)|changes(?:\/|$)|shared|templates|starred|archive|trash|drafts|unsorted|folders|tags|settings|help|onboarding|invite|share-invite|share(?:$|\/)|place-sync$|admin|signin|signup|connect|verify-email|reset-password|two-factor|s\/)/;

/**
 * Redirects to another host. Next rewrites a redirect whose host equals the request URL's host into a
 * relative path; in local development request.url is always "localhost:3000" whatever the Host header
 * says, so app.localhost → localhost would loop. Skip those (they only occur locally).
 */
function crossHostRedirect(request: NextRequest, target: URL): NextResponse | null {
  if (target.host === request.nextUrl.host) return null;
  return NextResponse.redirect(target);
}

/**
 * Only full HTML document loads need a nonce. Server actions (POST) and RSC fetches return React payloads,
 * not HTML, so their requests pass through untouched.
 */
function wantsNonce(request: NextRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const h = request.headers;
  return !h.has("rsc") && !h.has("next-router-prefetch") && h.get("purpose") !== "prefetch";
}

async function withNonce(request: NextRequest): Promise<NextResponse> {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
    convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "",
    appUrl: APP_URL,
    scriptHashes: [await themeBootScriptHash(), await signedInCheckScriptHash()],
    frameAncestors: request.nextUrl.pathname === "/place-sync" ? "self" : "none",
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

// Another account's session kept in the jar counts too (docs/MULTI_ACCOUNT_PLAN.md §2.1).
const hasSessionCookie = (request: NextRequest) => request.cookies.getAll().some((c) => !!c.value && (c.name.endsWith("folevi.session_token") || c.name.includes("folevi.session_token_multi-")));
const hasSignedInHint = (request: NextRequest) => request.cookies.get(SIGNED_IN_HINT)?.value === "1";

/**
 * Keeps the marketing site's signed-in hint matching the session cookie on app-host requests: sessions
 * from before the hint existed get it, and an expired or revoked session loses it. /api/auth/* sets it
 * itself (lib/auth/server.ts), since a sign-out request still carries the cookie it's about to clear, and so
 * does /api/signed-in, which checks the session itself rather than the cookie's presence.
 */
function syncSignedInHint(request: NextRequest, response: NextResponse): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/auth/") || request.nextUrl.pathname === SIGNED_IN_PATH) return response;
  const signedIn = hasSessionCookie(request);
  if (signedIn === hasSignedInHint(request)) return response;
  if (!signedIn && !request.cookies.has(SIGNED_IN_HINT)) return response;
  response.headers.append("set-cookie", hintCookie(signedIn, hintDomain(appHost, marketingHost), APP_URL.startsWith("https:")));
  return response;
}

export async function proxy(request: NextRequest) {
  const response = await route(request);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || "";
  return host === appHost ? syncSignedInHint(request, response) : response;
}

async function route(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  // The public host. Next's own internal requests (e.g. rendering a server action's redirect target) go to
  // request.url's origin but carry the original host in x-forwarded-host, as does Vercel's edge.
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || "";
  const pathname = url.pathname;

  // Canonical marketing host: www → apex.
  if (host === `www.${marketingHost}`) {
    return NextResponse.redirect(new URL(`${pathname}${url.search}`, MARKETING_URL), 308);
  }

  if (host === appHost) {
    if (pathname === "/") return NextResponse.redirect(new URL("/documents", request.url));
    if (MARKETING_ONLY.test(pathname) && !isAppPath(pathname)) {
      const redirect = crossHostRedirect(request, new URL(`${pathname}${url.search}`, MARKETING_URL));
      if (redirect) return redirect;
    }
  } else if (host === marketingHost && pathname === "/" && hasSignedInHint(request) && !url.searchParams.has("home")) {
    // Signed in on this browser: folevi.com opens your notes. folevi.com/?home still shows the landing page.
    const redirect = crossHostRedirect(request, new URL("/documents", APP_URL));
    if (redirect) {
      redirect.headers.set("cache-control", "private, no-store");
      return redirect;
    }
  } else if (host === marketingHost && isAppPath(pathname) && !pathname.startsWith("/api/")) {
    const redirect = crossHostRedirect(request, new URL(`${pathname}${url.search}`, APP_URL));
    if (redirect) return redirect;
  }

  if (host === appHost && NONCE_ROUTES.test(pathname) && wantsNonce(request)) return withNonce(request);
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon-16x16.png|favicon-32x32.png|icon.svg|apple-icon.png|sitemap.xml|robots.txt|manifest.webmanifest|sw.js|marketing/|fonts/|download/).*)"],
};
