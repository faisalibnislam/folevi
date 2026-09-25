import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseLoopsWebhook, verifyLoopsWebhook } from "@folevi/email";
import { verifyFileSignature } from "./lib/fileUrls";

const http = httpRouter();

const SAFE_INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

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
    const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`;
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
      },
    });
  }),
});

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

export default http;
