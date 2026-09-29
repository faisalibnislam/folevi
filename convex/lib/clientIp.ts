// Trusted client IP for Better Auth's rate limits.
//
// Browsers reach Better Auth through the Next.js proxy (app.folevi.com/api/auth/* → Convex site), so the
// connection Convex sees is the web server's, and a forwarded-for header sent straight to the Convex site
// URL could say anything. The web server therefore signs the visitor's IP (HMAC with
// FOLEVI_SERVER_SECRET, 60-second freshness) and Convex trusts that header only when the signature checks
// out. Every other forwarded-IP header is removed, so a request that skips the proxy has no client IP and
// falls into one shared bucket, so it can't pick a fresh IP per attempt to dodge the limits.
import { timingSafeEqualHex, toHex } from "./crypto";

export const CLIENT_IP_HEADER = "x-folevi-client-ip";
export const CLIENT_IP_SIGNATURE_HEADER = "x-folevi-client-ip-sig";
const MAX_SKEW_MS = 60_000;
const enc = new TextEncoder();

export async function clientIpSignature(secret: string, ip: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(`folevi-client-ip:${ip}:${timestamp}`)));
}

/** The signed client IP, or null when the header is missing, stale, malformed or not signed by the web server. */
export async function verifiedClientIp(headers: Headers, secret: string | undefined, now = Date.now()): Promise<string | null> {
  const ip = headers.get(CLIENT_IP_HEADER)?.trim();
  const [tsText, sig] = (headers.get(CLIENT_IP_SIGNATURE_HEADER) ?? "").split(".");
  if (!secret || !ip || !tsText || !sig || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  const ts = Number(tsText);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return null;
  return timingSafeEqualHex(await clientIpSignature(secret, ip, ts), sig) ? ip : null;
}

/**
 * Copy of the request that carries only a verified client IP (in CLIENT_IP_HEADER) and restores the
 * original host/proto forwarded by the Next.js proxy (what the Better Auth component's own route does).
 */
export async function withTrustedClientIp(request: Request, secret = process.env.FOLEVI_SERVER_SECRET): Promise<Request> {
  const ip = await verifiedClientIp(request.headers, secret);
  const headers = new Headers(request.headers);
  for (const name of [CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, "x-forwarded-for", "x-real-ip", "cf-connecting-ip", "true-client-ip"]) headers.delete(name);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  const host = request.headers.get("x-better-auth-forwarded-host");
  const proto = request.headers.get("x-better-auth-forwarded-proto");
  if (host) headers.set("x-forwarded-host", host);
  if (proto) headers.set("x-forwarded-proto", proto);
  return new Request(request, { headers });
}
