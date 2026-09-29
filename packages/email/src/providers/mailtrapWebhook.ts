// Mailtrap webhooks: signature verification and parsing.
//
// Mailtrap POSTs `{ "events": [...] }` (or JSON Lines, with one event or one `{events}` batch per line),
// up to 500 events per request, and retries on failure. `Mailtrap-Signature` is the hex HMAC-SHA256 of
// the raw request body with the webhook's signing secret.
import type { MailtrapEvent, MailtrapEventName } from "../types";

/** More than Mailtrap ever sends in one request (500); anything larger is refused. */
export const MAX_MAILTRAP_EVENTS = 1000;

const HEX_SHA256_RE = /^[0-9a-f]{64}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MESSAGE_ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;
const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SHORT_TOKEN_RE = /^[A-Za-z0-9_. -]{1,64}$/;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True when `signature` (the Mailtrap-Signature header) is the hex HMAC-SHA256 of `rawBody` under
 * `secret`. An empty secret or a missing / malformed signature is always false. Constant-time compare.
 */
export async function verifyMailtrapSignature(input: {
  rawBody: string;
  signature: string | null;
  secret: string | undefined;
}): Promise<boolean> {
  const { rawBody, secret } = input;
  if (!secret || typeof rawBody !== "string") return false;
  const signature = input.signature?.trim().toLowerCase() ?? "";
  if (!HEX_SHA256_RE.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return constantTimeEqual(signature, toHex(mac));
}

const EVENT_NAMES: Record<string, MailtrapEventName> = {
  delivery: "delivered",
  delivered: "delivered",
  soft_bounce: "soft_bounced",
  bounce: "bounced",
  hard_bounce: "bounced",
  suspension: "suspended",
  unsubscribe: "unsubscribed",
  open: "opened",
  click: "clicked",
  spam: "spam_complaint",
  spam_complaint: "spam_complaint",
  reject: "rejected",
};

export function normaliseMailtrapEventName(raw: string): MailtrapEventName {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return EVENT_NAMES[key] ?? "other";
}

function str(value: unknown, re: RegExp): string | undefined {
  return typeof value === "string" && re.test(value) ? value : undefined;
}

/** Seconds (Mailtrap) or milliseconds → milliseconds. */
function timestampMs(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

/** Keeps only what Folevi stores; drops IPs, user agents, clicked URLs and SMTP response text. */
function normaliseEvent(raw: unknown, now: number): MailtrapEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const eventId = str(obj.event_id, EVENT_ID_RE);
  if (!eventId || typeof obj.event !== "string") return null;
  const event: MailtrapEvent = {
    eventId,
    eventName: normaliseMailtrapEventName(obj.event),
    eventTime: timestampMs(obj.timestamp) ?? now,
  };
  const messageId = str(obj.message_id, MESSAGE_ID_RE);
  if (messageId) event.messageId = messageId;
  if (typeof obj.email === "string" && obj.email.length > 0 && obj.email.length <= 254) event.recipient = obj.email;
  const category = str(obj.category, SHORT_TOKEN_RE);
  if (category) event.category = category;
  const vars = obj.custom_variables;
  if (vars && typeof vars === "object" && !Array.isArray(vars)) {
    const attempt = str((vars as Record<string, unknown>).attempt, ATTEMPT_ID_RE);
    if (attempt) event.attemptId = attempt;
  }
  const bounceCategory = str(obj.bounce_category, SHORT_TOKEN_RE);
  if (bounceCategory) event.bounceCategory = bounceCategory;
  const code = typeof obj.response_code === "number" ? obj.response_code : Number(obj.response_code);
  if (Number.isInteger(code) && code >= 100 && code <= 999) event.responseCode = code;
  return event;
}

function collect(parsed: unknown, into: unknown[]): boolean {
  if (Array.isArray(parsed)) {
    into.push(...parsed);
    return true;
  }
  if (parsed && typeof parsed === "object") {
    const events = (parsed as Record<string, unknown>).events;
    if (Array.isArray(events)) into.push(...events);
    else into.push(parsed);
    return true;
  }
  return false;
}

/**
 * Parses a Mailtrap webhook body: `{events: [...]}` JSON, or JSON Lines. Returns null when the body is
 * not valid JSON / JSON Lines or carries more than MAX_MAILTRAP_EVENTS events. Individual events
 * without an `event_id` or `event` are skipped (counted in `ignored`) since they can't be deduplicated.
 */
export function parseMailtrapWebhook(
  rawBody: string,
  now: number = Date.now(),
): { events: MailtrapEvent[]; ignored: number } | null {
  if (typeof rawBody !== "string" || rawBody.trim().length === 0) return null;
  const raw: unknown[] = [];
  let ok: boolean;
  try {
    ok = collect(JSON.parse(rawBody), raw);
  } catch {
    // Not a single JSON document: try JSON Lines.
    ok = true;
    for (const line of rawBody.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        if (!collect(JSON.parse(line), raw)) return null;
      } catch {
        return null;
      }
    }
  }
  if (!ok || raw.length > MAX_MAILTRAP_EVENTS) return null;
  const events: MailtrapEvent[] = [];
  let ignored = 0;
  for (const item of raw) {
    const event = normaliseEvent(item, now);
    if (event) events.push(event);
    else ignored++;
  }
  return { events, ignored };
}
