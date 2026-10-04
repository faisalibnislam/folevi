import "server-only";
import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

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
    if (referer) headers.set("referer", devOrigin + new URL(referer).pathname);
  }
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
  return new Request(request.url, init);
}

/** Proxies /api/auth/* to the Convex site URL (so auth cookies are first-party on the app host). */
export const handler = {
  GET: async (request: Request) => convexAuth.handler.GET(await withSignedClientIp(request)),
  POST: async (request: Request) => convexAuth.handler.POST(await withSignedClientIp(request)),
};
