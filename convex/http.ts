import { httpRouter } from "convex/server";
import { polarWebhook } from "./billing";
import { mcpHttp } from "./mcpServer";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  fetchReceivedEmail,
  parseResendWebhook,
  readInboundMessage,
  sendingDomain,
  ticketNumberFromSubject,
  verifyResendSignature,
} from "@folevi/email";
import { SUPPORT_DOMAIN } from "./lib/support";
import { verifyFileSignature } from "./lib/fileUrls";
import { sha256Hex } from "./lib/crypto";
import type { Id } from "./_generated/dataModel";
import { AUDIO_MIMES } from "./lib/images";
import { createAuth } from "./auth";
import { withTrustedClientIp } from "./lib/clientIp";

const http = httpRouter();

const SAFE_INLINE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  ...AUDIO_MIMES,
]);

/**
 * One "bytes=a-b" range (the only kind audio players ask for), clamped to the file, or null for the whole
 * file. An unsatisfiable range returns "invalid".
 */
export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | "invalid" {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // "bytes=-N": the last N bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

/**
 * RFC 6266 Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name. encodeURIComponent
 * leaves ' ( ) * unescaped, which are not valid attr-chars. A name like "Maya's Folio.zip" would make
 * browsers drop the header's filename entirely, so those are percent-encoded too.
 */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%;]/g, "_").slice(0, 180) || "file";
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Signed file delivery. Images, PDFs and audio recordings render inline; everything else downloads. All
 * responses carry nosniff and a sandboxing CSP so uploaded content can never execute script. Byte ranges
 * are served so audio players can seek (Safari won't play audio without them).
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
    const headers: Record<string, string> = {
      "content-type": inline ? file.mimeType : "application/octet-stream",
      "content-disposition": disposition,
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
      "referrer-policy": "no-referrer",
      "cache-control": "private, max-age=3600",
      // The app may read an image's pixels (to pick a note's colours from it). The signed URL is already
      // the capability; this only lets our own app origin read the bytes it can already display.
      ...corsFor(request.headers.get("origin")),
    };
    const range = byteRange(request.headers.get("range"), blob.size);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${blob.size}` },
      });
    }
    if (range) {
      return new Response(blob.slice(range.start, range.end + 1), {
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${range.start}-${range.end}/${blob.size}`,
          "content-length": String(range.end - range.start + 1),
        },
      });
    }
    return new Response(blob, { status: 200, headers });
  }),
});

/** CORS for the app origin (FOLEVI_APP_URL), plus local dev hosts outside production. */
function corsFor(origin: string | null): Record<string, string> {
  if (!origin) return {};
  let allowed: boolean;
  try {
    const app = process.env.FOLEVI_APP_URL ? new URL(process.env.FOLEVI_APP_URL).origin : null;
    const host = new URL(origin).hostname;
    allowed =
      origin === app ||
      (process.env.FOLEVI_ENV !== "production" &&
        (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")));
  } catch {
    allowed = false;
  }
  return allowed ? { "access-control-allow-origin": origin, vary: "origin" } : {};
}

/**
 * Polar events (subscriptions, orders, refunds): Standard Webhooks signature checked in
 * billing.polarWebhook under POLAR_WEBHOOK_SECRET; each delivery applied once. docs/BILLING.md.
 */
http.route({ path: "/webhooks/polar", method: "POST", handler: polarWebhook });

/** One Resend event per request, metadata only (bodies are fetched): small. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * Resend webhooks, one endpoint for everything Resend reports:
 * - delivery events (email.delivered, email.bounced, email.complained, email.failed, email.suppressed, …)
 *   update the send log and suppress addresses that hard-bounced or complained (email.recordProviderEvents);
 * - email.received: mail to support@folevi.com (and security@) becomes support tickets (docs/SUPPORT.md).
 *   The event carries only the email id; the message is read from Resend's Received emails API with
 *   RESEND_API_KEY and filed by support.ingestInbound.
 *
 * Resend webhooks are account-wide, and the account may serve other domains too: delivery events count only
 * for mail sent from Folevi's sending domain, received mail only when it was for a folevi.com address.
 * Anything else is acknowledged and dropped without being stored or fetched.
 *
 * Signed with Svix (svix-id, svix-timestamp, svix-signature) under RESEND_WEBHOOK_SECRET; without the
 * secret every request is refused. Events are deduplicated on svix-id (stable across Resend's retries),
 * received mail also on its email id. A failure Resend should retry (the API unreachable, the key missing)
 * answers 5xx. Nothing is echoed, and logs carry counts and outcomes only, never addresses or text.
 */
http.route({
  path: "/webhooks/resend",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret || secret === "none") return new Response("Webhook not configured", { status: 401 });
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_WEBHOOK_BYTES) return new Response("Too large", { status: 413 });
    const rawBody = await request.text();
    if (rawBody.length > MAX_WEBHOOK_BYTES) return new Response("Too large", { status: 413 });
    const id = request.headers.get("svix-id");
    const ok = await verifyResendSignature({
      rawBody,
      id,
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
      secret,
    });
    if (!ok || !id) return new Response("Invalid signature", { status: 401 });
    const parsed = parseResendWebhook(rawBody, id);
    if (!parsed) return new Response("Malformed body", { status: 400 });

    if (parsed.kind === "ignored") return new Response("ok", { status: 200 });

    if (parsed.kind === "delivery") {
      const ours = `@${sendingDomain(process.env as Record<string, string | undefined>)}`;
      if (!parsed.from?.endsWith(ours)) return new Response("ok", { status: 200 });
      const result = await ctx.runMutation(internal.email.recordProviderEvents, { events: [parsed.event] });
      console.log(JSON.stringify({ event: "email.webhook", provider: "resend", name: parsed.event.eventName, stored: result.stored }));
      return new Response("ok", { status: 200 });
    }

    // email.received
    if (!parsed.recipients.some((r) => r.endsWith(`@${SUPPORT_DOMAIN}`))) return new Response("ok", { status: 200 });
    const log = (outcome: string) => console.log(JSON.stringify({ event: "support.inbound", provider: "resend", outcome }));
    if (await ctx.runQuery(internal.support.inboundSeen, { inboundMessageId: parsed.emailId })) {
      log("duplicate");
      return new Response("ok", { status: 200 });
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey === "none") {
      log("not_configured");
      return new Response("Try again later", { status: 503 });
    }
    const fetched = await fetchReceivedEmail({ apiKey, emailId: parsed.emailId });
    if (!fetched.ok) {
      log(`fetch_${fetched.status}`);
      return fetched.retryable ? new Response("Try again later", { status: 503 }) : new Response("ok", { status: 200 });
    }
    const message = readInboundMessage(fetched.message);
    if (!message) {
      log("unreadable");
      return new Response("ok", { status: 200 });
    }
    const result = await ctx.runMutation(internal.support.ingestInbound, {
      inboundMessageId: parsed.emailId,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      text: message.text,
      rfcMessageId: message.rfcMessageId,
      automated: message.automated,
      ticketNumber: ticketNumberFromSubject(message.subject),
    });
    log(result.outcome);
    return new Response("ok", { status: 200 });
  }),
});

/**
 * Folevi's MCP server (convex/mcpServer.ts): connected apps reach notes and tasks here, with an OAuth
 * access token. Apps use https://app.folevi.com/mcp, which the web app forwards to this route.
 */
for (const method of ["POST", "GET", "DELETE", "OPTIONS"] as const) http.route({ path: "/mcp", method, handler: mcpHttp });

/**
 * A person's tasks as an iCalendar feed (convex/calendarFeeds.ts), for calendar apps. The token in the
 * path is the secret; an unknown one is a plain 404.
 */
http.route({
  pathPrefix: "/ical/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).pathname.slice("/ical/".length).replace(/\.ics$/, "");
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return new Response("Not found", { status: 404 });
    const feed = await ctx.runQuery(internal.calendarFeeds.render, { tokenHash: await sha256Hex(token) });
    if (!feed) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    await ctx.runMutation(internal.calendarFeeds.touch, { feedId: feed.feedId as Id<"calendarFeeds"> });
    return new Response(feed.ics, {
      headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300", "content-disposition": 'inline; filename="folevi-tasks.ics"', "x-robots-tag": "noindex" },
    });
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
  ),
});

// Better Auth (sign-up, sign-in, email verification, password reset, two-factor, sessions, JWKS).
// Reached through the Next.js proxy at /api/auth/* so cookies are first-party on the app host. Registered
// here rather than with authComponent.registerRoutes so forwarded-IP headers can be checked first: rate
// limits key on the client IP, and only an IP signed by the web server is trusted (lib/clientIp.ts).
const authRoute = httpAction(async (ctx, request) =>
  createAuth(ctx).handler(await withTrustedClientIp(request)),
);
http.route({ pathPrefix: "/api/auth/", method: "GET", handler: authRoute });
http.route({ pathPrefix: "/api/auth/", method: "POST", handler: authRoute });
http.route({
  path: "/.well-known/openid-configuration",
  method: "GET",
  handler: httpAction(async () =>
    Response.redirect(
      `${process.env.CONVEX_SITE_URL}/api/auth/convex/.well-known/openid-configuration`,
    ),
  ),
});

export default http;
