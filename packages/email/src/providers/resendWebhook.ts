// Resend webhooks: signature verification and parsing.
//
// Resend signs with Svix. Each request carries `svix-id`, `svix-timestamp` (Unix seconds) and
// `svix-signature` ("v1,<base64>", possibly several separated by spaces while a secret rotates). The
// signature is the base64 HMAC-SHA256 of `${svix-id}.${svix-timestamp}.${rawBody}`, keyed with the base64
// part of the secret after its "whsec_" prefix. One request is one event: `{type, created_at, data}`.
// Delivery events (email.delivered, email.bounced, …) carry the Resend email id and our tags; an inbound
// message is `email.received` with metadata only (the body is read from the Received emails API).
//
// Webhooks are account-wide: a Resend account that also sends or receives for other domains reports those
// too. Each parsed event therefore carries the addresses needed to keep only Folevi's own: the sender of
// a delivery event, the recipients of a received email (see convex/http.ts).
import type { EmailEvent, EmailEventName } from "../types";
import { parseAddress } from "./inbound";

/** How far a webhook's timestamp may be from now (Svix's own tolerance). */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

const SVIX_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SHORT_TOKEN_RE = /^[A-Za-z0-9_. -]{1,64}$/;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True when the Svix headers sign `rawBody` under `secret` ("whsec_…") and the timestamp is within
 * WEBHOOK_TOLERANCE_MS of `now`. An empty secret, a missing header or a malformed value is always false.
 * Constant-time compare against every signature offered.
 */
export async function verifyResendSignature(input: {
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string | undefined;
  now?: number;
}): Promise<boolean> {
  const { rawBody, id, timestamp, signature, secret } = input;
  if (!secret || typeof rawBody !== "string" || !id || !timestamp || !signature) return false;
  if (!SVIX_ID_RE.test(id) || !/^\d{1,12}$/.test(timestamp)) return false;
  const now = input.now ?? Date.now();
  if (Math.abs(now - Number(timestamp) * 1000) > WEBHOOK_TOLERANCE_MS) return false;
  const keyBytes = base64ToBytes(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret);
  if (!keyBytes || keyBytes.length === 0) return false;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = bytesToBase64(mac);
  let ok = false;
  for (const part of signature.trim().split(/\s+/).slice(0, 10)) {
    const [version, value] = part.split(",", 2);
    if (version === "v1" && value && constantTimeEqual(value, expected)) ok = true;
  }
  return ok;
}

const EVENT_NAMES: Record<string, EmailEventName> = {
  "email.delivered": "delivered",
  "email.delivery_delayed": "soft_bounced",
  "email.bounced": "bounced",
  "email.complained": "spam_complaint",
  "email.failed": "rejected",
  "email.suppressed": "suppressed",
  "email.opened": "opened",
  "email.clicked": "clicked",
};

/** A bounce Resend calls "Transient" (mailbox full, greylisting) is a soft bounce, not a dead address. */
function bounceName(data: Record<string, unknown>): EmailEventName {
  const bounce = data.bounce;
  const type = bounce && typeof bounce === "object" ? (bounce as Record<string, unknown>).type : undefined;
  return typeof type === "string" && type.toLowerCase() === "transient" ? "soft_bounced" : "bounced";
}

/** Tags as Resend echoes them: `{name: value}` or `[{name, value}]`. */
function readTags(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const t of raw.slice(0, 20)) {
      if (t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string" && typeof (t as { value?: unknown }).value === "string") {
        out[(t as { name: string }).name] = (t as { value: string }).value;
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

export type ResendWebhook =
  /** `from`: the sender's lowercased address, to tell Folevi's own sends from other domains'. */
  | { kind: "delivery"; event: EmailEvent; from: string | null }
  /** `recipients`: every lowercased address it was for (to, cc, bcc, received_for). */
  | { kind: "received"; eventId: string; emailId: string; recipients: string[] }
  | { kind: "ignored"; type: string };

function addresses(...lists: unknown[]): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    for (const item of (Array.isArray(list) ? list : list === undefined || list === null ? [] : [list]).slice(0, 50)) {
      const a = parseAddress(item);
      if (a) out.add(a.address);
    }
  }
  return [...out];
}

/**
 * Reads one (signature-verified) Resend webhook. `eventId` is the `svix-id` header: unique per event and
 * the same on every retry, so it is what deduplicates. Null when the body isn't a Resend event. Keeps only
 * what Folevi stores; drops subjects, IPs, user agents and clicked links.
 */
export function parseResendWebhook(rawBody: string, eventId: string, now: number = Date.now()): ResendWebhook | null {
  if (typeof rawBody !== "string" || !SVIX_ID_RE.test(eventId)) return null;
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : "";
  const data = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? (obj.data as Record<string, unknown>) : null;
  if (!type || !data) return null;
  const emailId = typeof data.email_id === "string" && EMAIL_ID_RE.test(data.email_id) ? data.email_id : undefined;
  if (type === "email.received") return emailId ? { kind: "received", eventId, emailId, recipients: addresses(data.to, data.cc, data.bcc, data.received_for) } : null;
  const known = EVENT_NAMES[type];
  if (!known && !type.startsWith("email.")) return { kind: "ignored", type: type.slice(0, 64) };
  const created = Date.parse(typeof obj.created_at === "string" ? obj.created_at : "");
  const event: EmailEvent = {
    eventId,
    eventName: type === "email.bounced" ? bounceName(data) : (known ?? "other"),
    eventTime: Number.isFinite(created) ? created : now,
  };
  if (emailId) event.messageId = emailId;
  const to = Array.isArray(data.to) ? data.to[0] : data.to;
  if (typeof to === "string" && to.length > 0 && to.length <= 254) event.recipient = to;
  const tags = readTags(data.tags);
  if (tags.template && SHORT_TOKEN_RE.test(tags.template)) event.category = tags.template;
  if (tags.attempt && ATTEMPT_ID_RE.test(tags.attempt)) event.attemptId = tags.attempt;
  const bounce = data.bounce && typeof data.bounce === "object" ? (data.bounce as Record<string, unknown>) : null;
  const sub = bounce ? [bounce.type, bounce.subType].filter((s) => typeof s === "string").join(":") : "";
  if (sub && SHORT_TOKEN_RE.test(sub.replace(/:/g, "_"))) event.bounceCategory = sub.slice(0, 64);
  return { kind: "delivery", event, from: parseAddress(data.from)?.address ?? null };
}
