// Outbound webhooks (convex/webhooks.ts): the events, how a place is named for them, the payload's
// signature, the retry schedule, which endpoint addresses are allowed, and `emitWebhook`, the hook the
// places where notes, tasks and comments change call. It costs one indexed lookup when nobody in that
// place has a webhook for the event, and otherwise queues a row (webhookEvents) for a scheduled function
// to fan out, so the person's own edit stays fast.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { checkUrl, isPrivateAddress, lookup } from "./ai/web";
import { scopeOfRow, type Scope } from "./scope";

export const WEBHOOK_EVENTS = ["note.created", "note.updated", "note.deleted", "task.created", "task.completed", "comment.created"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const MAX_WEBHOOKS = 5;
/** A new note is sent after this long, so the title typed right after making it is in the event. */
export const NOTE_CREATED_DELAY_MS = 30_000;
/** Edits to a note make at most one note.updated a minute (the event carries the note as it is then). */
export const NOTE_UPDATED_WINDOW_MS = 60_000;
/** Waits before each retry: six attempts over about a day. */
export const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 16 * 60 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** An endpoint is turned off once this many deliveries in a row ran out of attempts. */
export const DISABLE_AFTER_FAILED_DELIVERIES = 3;
export const DELIVERY_TIMEOUT_MS = 10_000;
/** Attempts kept per endpoint for the delivery log in Settings (codes and times, never bodies). */
export const LOG_SIZE = 20;

/** A place as webhook rows name it: someone's Personal, or a workspace. */
export function placeKey(scope: Scope): string {
  return scope.kind === "personal" ? `p:${scope.profileId}` : `w:${scope.workspaceId}`;
}

/** Why an endpoint address can't be used (checked when it's added; its addresses are checked at each delivery), or null. */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Enter the full address, starting with https://.";
  }
  if (url.protocol !== "https:") return "Webhook addresses must start with https://.";
  if (raw.length > 2000) return "That address is too long.";
  const checked = checkUrl(url.href);
  if (!checked.ok) {
    if (/private or local/.test(checked.error)) return "Addresses on private or local networks can't receive webhooks.";
    if (/user name or password/.test(checked.error)) return "Leave the user name and password out of the address.";
    if (/ports/.test(checked.error)) return "Use the standard https port (443).";
    return "Enter the full address, starting with https://.";
  }
  return null;
}

const enc = new TextEncoder();

/** The `Folevi-Signature` header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" keyed with the secret>`. */
export async function signature(secret: string, body: string, unixSeconds: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${unixSeconds}.${body}`)));
  let hex = "";
  for (const b of mac) hex += b.toString(16).padStart(2, "0");
  return `t=${unixSeconds},v1=${hex}`;
}

export type SendResult = { ok: boolean; statusCode?: number; error?: string };

/**
 * One delivery attempt: the address checked again (https, a public host whose addresses are all public),
 * the body POSTed with its signature, 10 seconds at most. Redirects are never followed (a 3xx is a failed
 * attempt), no cookies or credentials are sent, and the answer's body is never read or kept.
 */
export async function postWebhook(url: string, secret: string, body: string, meta: { eventId: string; type: string }): Promise<SendResult> {
  if (webhookUrlProblem(url)) return { ok: false, error: "address not allowed" };
  const target = new URL(url);
  const host = target.hostname.replace(/^\[|\]$/g, "");
  // IP addresses were checked by webhookUrlProblem; names are looked up and every address must be public.
  if (!/^[\d.]+$/.test(host) && !host.includes(":")) {
    const addresses = await lookup(host);
    if (!addresses || !addresses.length) return { ok: false, error: "address not found" };
    if (addresses.some(isPrivateAddress)) return { ok: false, error: "private address refused" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(target.href, {
      method: "POST",
      redirect: "manual",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "Folevi-Webhooks/1.0 (+https://folevi.com/docs/webhooks)",
        "folevi-event-id": meta.eventId,
        "folevi-event-type": meta.type,
        "folevi-signature": await signature(secret, body, Math.floor(Date.now() / 1000)),
      },
      body,
    });
    void res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) return { ok: false, statusCode: res.status, error: "redirect not followed" };
    return res.ok ? { ok: true, statusCode: res.status } : { ok: false, statusCode: res.status };
  } catch {
    return { ok: false, error: controller.signal.aborted ? "timed out" : "couldn't connect" };
  } finally {
    clearTimeout(timer);
  }
}

/** The wait before the next attempt after `attempts` failed ones, or null when there are no more. */
export function retryDelay(attempts: number): number | null {
  return attempts >= MAX_ATTEMPTS ? null : (RETRY_DELAYS_MS[attempts - 1] ?? null);
}

/**
 * Queues an event for webhooks in the place of `doc` (when anyone there listens for it). note.updated
 * waits a minute and absorbs further edits; so does a new note, briefly. Templates and collection rows
 * aren't notes and send nothing.
 */
export async function emitWebhook(
  ctx: MutationCtx,
  type: WebhookEvent,
  doc: Doc<"documents">,
  extra: { taskBlockId?: string; commentId?: Id<"comments"> } = {},
): Promise<void> {
  if (doc.kind !== "document" && doc.kind !== "daily") return;
  const place = placeKey(scopeOfRow(doc));
  const listeners = await ctx.db
    .query("webhookPlaces")
    .withIndex("by_place", (q) => q.eq("place", place))
    .take(50);
  if (!listeners.some((l) => l.events.includes(type))) return;
  const now = Date.now();
  let dueAt = now;
  let dedupeKey: string | undefined;
  if (type === "note.created" || type === "note.updated") {
    // One waiting note event per note: a newer edit is part of the one already waiting.
    dedupeKey = `note:${doc._id}`;
    const waiting = await ctx.db
      .query("webhookEvents")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (waiting) return;
    dueAt = now + (type === "note.created" ? NOTE_CREATED_DELAY_MS : NOTE_UPDATED_WINDOW_MS);
  }
  const eventId = await ctx.db.insert("webhookEvents", { place, type, documentId: doc._id, ...extra, ...(dedupeKey ? { dedupeKey } : {}), createdAt: now });
  await ctx.scheduler.runAt(dueAt, internal.webhooks.fanout, { eventId });
}
