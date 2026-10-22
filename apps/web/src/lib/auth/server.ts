import "server-only";
import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { APP_HOST, APP_URL, MARKETING_HOST } from "@/lib/env";
import { hintCookie, hintDomain, sessionChange } from "@/lib/auth/signedInHint";
import { appleFormPost, withAppleUser } from "@/lib/auth/appleCallback";

const convexAuth = convexBetterAuthNextJs({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "",
});

/** Server-side bridge to Better Auth running inside Convex. */
export const { getToken, isAuthenticated } = convexAuth;

// Must match convex/lib/clientIp.ts.
const CLIENT_IP_HEADER = "x-folevi-client-ip";
const CLIENT_IP_SIGNATURE_HEADER = "x-folevi-client-ip-sig";
const enc = new TextEncoder();

/**
 * The visitor's IP as reported by the platform. On Vercel, x-real-ip / x-forwarded-for are set by the
 * edge and can't be supplied by the browser. Locally there is no proxy, so it's the loopback address.
 */
function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "127.0.0.1";
}

async function sign(secret: string, ip: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`folevi-client-ip:${ip}:${timestamp}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Adds the signed client IP that Convex uses to key Better Auth's rate limits. */
async function withSignedClientIp(request: Request): Promise<Request> {
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(CLIENT_IP_SIGNATURE_HEADER);
  const secret = process.env.FOLEVI_SERVER_SECRET;
  if (secret) {
    const ip = clientIp(request);
    const ts = Date.now();
    headers.set(CLIENT_IP_HEADER, ip);
    headers.set(CLIENT_IP_SIGNATURE_HEADER, `${ts}.${await sign(secret, ip, ts)}`);
  }
  // Development only: a second local dev server (another port, while 3000 is busy) presents the origin the
  // development backend trusts, so signing in works there too. Unset everywhere else.
  const devOrigin = process.env.NODE_ENV === "development" ? process.env.FOLEVI_DEV_AUTH_ORIGIN : undefined;
  if (devOrigin) {
    if (headers.has("origin")) headers.set("origin", devOrigin);
    const referer = headers.get("referer");
    if (referer) {
      try {
        headers.set("referer", devOrigin + new URL(referer).pathname);
      } catch {
        headers.delete("referer");
      }
    }
  }
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
  return new Request(request.url, init);
}

/**
 * The OAuth provider (connected apps, convex/auth.ts) answers a fetch() with `{ redirect: true, url }` and
 * a page load with a real redirect, telling them apart by Sec-Fetch-Mode. Forwarded from here, every
 * request reaches Convex looking like a fetch, so a browser opening the authorize link (Claude, ChatGPT)
 * would be shown that JSON. A page load (not a cors fetch, not asking for JSON) gets the redirect it
 * meant, with any cookies it set.
 */
async function redirectPageLoads(request: Request, response: Response): Promise<Response> {
  if (!new URL(request.url).pathname.includes("/oauth2/")) return response;
  if (request.headers.get("sec-fetch-mode") === "cors" || (request.headers.get("accept") ?? "").includes("application/json")) return response;
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return response;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  const { redirect, url } = (body ?? {}) as { redirect?: unknown; url?: unknown };
  if (redirect !== true || typeof url !== "string") return response;
  // A path ("/oauth/consent?...") stays relative, so the browser stays on the host it asked (the request's
  // own URL may name another one behind the proxy); an absolute one (the app's redirect_uri) must be http(s).
  const location = url;
  if (!(url.startsWith("/") && !url.startsWith("//"))) {
    try {
      if (!["https:", "http:"].includes(new URL(url).protocol)) return response;
    } catch {
      return response;
    }
  }
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** Keeps the marketing site's signed-in hint in step with the session cookie Better Auth just set or cleared. */
function withSignedInHint(response: Response): Response {
  const change = sessionChange(response.headers.getSetCookie());
  if (!change) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", hintCookie(change === "set", hintDomain(APP_HOST, MARKETING_HOST), APP_URL.startsWith("https:")));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Adds a Set-Cookie to a response (Apple's `user` cookie being cleared). */
function withCookie(response: Response, cookie: string | null): Response {
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const secureCookies = () => APP_URL.startsWith("https:");

/**
 * Proxies /api/auth/* to the Convex site URL (so auth cookies are first-party on the app host). Apple's
 * cross-site form post to its callback is answered here with a same-site GET of it (lib/auth/appleCallback.ts).
 */
export const handler = {
  GET: async (request: Request) => {
    const apple = withAppleUser(request, secureCookies());
    return withCookie(withSignedInHint(await redirectPageLoads(apple.request, await convexAuth.handler.GET(await withSignedClientIp(apple.request)))), apple.clear);
  },
  POST: async (request: Request) => (await appleFormPost(request, secureCookies())) ?? withSignedInHint(await convexAuth.handler.POST(await withSignedClientIp(request))),
};
