import { httpRouter } from "convex/server";
import { stripeWebhook } from "./billing";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseMailtrapWebhook, verifyMailtrapSignature } from "@folevi/email";
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

/** Mailtrap sends at most 500 events per request; a few MB is plenty. */
const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;
const EVENTS_PER_MUTATION = 100;

/**
 * Mailtrap delivery webhooks: delivery, soft bounce, bounce, suspension, reject, spam complaint (and
 * unsubscribe). `Mailtrap-Signature` must be the hex HMAC-SHA256 of the raw body under
 * MAILTRAP_WEBHOOK_SECRET (constant-time compare); without a secret every request is refused. Accepts
 * `{events: [...]}` JSON or JSON Lines. Events are deduplicated on event_id, so Mailtrap's retries are
 * harmless. Responses never echo the payload.
 */
http.route({
  path: "/webhooks/mailtrap",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.MAILTRAP_WEBHOOK_SECRET;
    if (!secret || secret === "none") return new Response("Webhook not configured", { status: 401 });
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_WEBHOOK_BYTES) return new Response("Too large", { status: 413 });
    const rawBody = await request.text();
    if (rawBody.length > MAX_WEBHOOK_BYTES) return new Response("Too large", { status: 413 });
    const ok = await verifyMailtrapSignature({ rawBody, signature: request.headers.get("mailtrap-signature"), secret });
    if (!ok) return new Response("Invalid signature", { status: 401 });
    const parsed = parseMailtrapWebhook(rawBody);
    if (!parsed) return new Response("Malformed body", { status: 400 });
    let stored = 0;
    for (let i = 0; i < parsed.events.length; i += EVENTS_PER_MUTATION) {
      const result = await ctx.runMutation(internal.email.recordMailtrapEvents, { events: parsed.events.slice(i, i + EVENTS_PER_MUTATION) });
      stored += result.stored;
    }
    console.log(JSON.stringify({ event: "email.webhook", provider: "mailtrap", received: parsed.events.length, stored, ignored: parsed.ignored }));
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
