import { httpRouter } from "convex/server";
import { stripeWebhook } from "./billing";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseLoopsWebhook, verifyLoopsWebhook } from "@folevi/email";
import { verifyFileSignature } from "./lib/fileUrls";
import { createAuth } from "./auth";
import { withTrustedClientIp } from "./lib/clientIp";

const http = httpRouter();

const SAFE_INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

/**
 * RFC 6266 Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name. encodeURIComponent
 * leaves ' ( ) * unescaped, which are not valid attr-chars — a name like "Maya's Folio.zip" would make
 * browsers drop the header's filename entirely — so those are percent-encoded too.
 */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%;]/g, "_").slice(0, 180) || "file";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Signed file delivery. Images/PDFs render inline; everything else downloads. All responses carry
 * nosniff and a sandboxing CSP so uploaded content can never execute script.
 */
http.route({
  pathPrefix: "/files/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const fileId = url.pathname.slice("/files/".length);
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") ?? "";
    if (!/^[0-9A-Z]{26}$/.test(fileId) || !(await verifyFileSignature(fileId, exp, sig))) {
      return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    }
    const file = await ctx.runQuery(internal.files.byPublicId, { fileId });
    if (!file || file.status !== "ready") return new Response("Not found", { status: 404 });
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) return new Response("Not found", { status: 404 });
    const inline = SAFE_INLINE.has(file.mimeType);
    const disposition = contentDisposition(inline ? "inline" : "attachment", file.filename);
    return new Response(blob, {
      status: 200,
      headers: {
        "content-type": inline ? file.mimeType : "application/octet-stream",
        "content-disposition": disposition,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "cross-origin-resource-policy": "cross-origin",
        "referrer-policy": "no-referrer",
        "cache-control": "private, max-age=3600",
        // The app may read an image's pixels (to pick a note's colours from it). The signed URL is already
        // the capability; this only lets our own app origin read the bytes it can already display.
        ...corsFor(request.headers.get("origin")),
      },
    });
  }),
});

/** CORS for the app origin (FOLEVI_APP_URL), plus local dev hosts outside production. */
function corsFor(origin: string | null): Record<string, string> {
  if (!origin) return {};
  let allowed: boolean;
  try {
    const app = process.env.FOLEVI_APP_URL ? new URL(process.env.FOLEVI_APP_URL).origin : null;
    const host = new URL(origin).hostname;
    allowed = origin === app || (process.env.FOLEVI_ENV !== "production" && (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")));
  } catch {
    allowed = false;
  }
  return allowed ? { "access-control-allow-origin": origin, vary: "origin" } : {};
}

/** Stripe events (subscriptions, invoices, refunds); signature-verified in billing.stripeWebhook. */
http.route({ path: "/webhooks/stripe", method: "POST", handler: stripeWebhook });

/** Loops delivery webhooks (only when LOOPS_WEBHOOK_SECRET is configured). Signature-verified. */
http.route({
  path: "/webhooks/loops",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.LOOPS_WEBHOOK_SECRET;
    if (!secret) return new Response("Webhook not configured", { status: 404 });
    const rawBody = await request.text();
    const ok = await verifyLoopsWebhook({
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
      rawBody,
      secret,
    });
    if (!ok) return new Response("Invalid signature", { status: 401 });
    const event = parseLoopsWebhook(rawBody);
    if (!event) return new Response("Ignored", { status: 202 });
    await ctx.runMutation(internal.email.recordProviderEvent, {
      webhookId: request.headers.get("webhook-id")!,
      eventName: event.eventName,
      eventTime: event.eventTime,
      transactionalId: event.transactionalId,
      providerEmailId: event.emailId,
      recipient: event.recipient,
    });
    return new Response("ok", { status: 200 });
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "cache-control": "no-store" } })),
});

// Better Auth (sign-up, sign-in, email verification, password reset, two-factor, sessions, JWKS).
// Reached through the Next.js proxy at /api/auth/* so cookies are first-party on the app host. Registered
// here rather than with authComponent.registerRoutes so forwarded-IP headers can be checked first: rate
// limits key on the client IP, and only an IP signed by the web server is trusted (lib/clientIp.ts).
const authRoute = httpAction(async (ctx, request) => createAuth(ctx).handler(await withTrustedClientIp(request)));
http.route({ pathPrefix: "/api/auth/", method: "GET", handler: authRoute });
http.route({ pathPrefix: "/api/auth/", method: "POST", handler: authRoute });
http.route({
  path: "/.well-known/openid-configuration",
  method: "GET",
  handler: httpAction(async () => Response.redirect(`${process.env.CONVEX_SITE_URL}/api/auth/convex/.well-known/openid-configuration`)),
});

export default http;
