// Mailtrap Email Inbound: the "inbound_receiving" webhook, the Messages API, and turning a received email
// into plain support text.
//
// When a message lands in an inbound inbox, Mailtrap POSTs `{ "events": [...] }` (or JSON Lines) where
// each event is `inbound.message_received` with an event id, a timestamp, the inbox id, Mailtrap's message
// id and the sender's name. The body is signed like the sending webhook: `Mailtrap-Signature` is the hex
// HMAC-SHA256 of the raw body with the webhook's signing secret (verifyMailtrapSignature). The event
// carries no content: the message itself is read from
//   GET https://mailtrap.io/api/inbound/inboxes/{inbox_id}/messages/{id}
// which returns the parsed message (from, to, cc, subject, rfc_message_id, in_reply_to, references,
// selected lowercased headers, text_body, html_body). See docs/SUPPORT.md.
//
// Nothing here logs, and nothing returns more of a message than the caller asked for.

export const MAILTRAP_INBOUND_API = "https://mailtrap.io/api/inbound";

/** Mailtrap batches events; anything larger than this is refused. */
export const MAX_INBOUND_EVENTS = 100;
/** Stored message text is capped (characters, after quote stripping). */
export const MAX_INBOUND_TEXT = 20_000;
export const MAX_INBOUND_SUBJECT = 200;

const EVENT_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const INBOX_ID_RE = /^\d{1,12}$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export interface InboundEvent {
  eventId: string;
  inboxId: string;
  messageId: string;
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function readEvent(raw: unknown): InboundEvent | "ignored" | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const name = str(e.event) ?? str(e.type) ?? str(e.event_type) ?? "";
  if (name !== "inbound.message_received") return "ignored";
  const eventId = str(e.event_id) ?? str(e.id);
  const inboxId = str(e.inbox_id) ?? str(e.inbound_inbox_id);
  const messageId = str(e.message_id) ?? str(e.inbound_message_id);
  if (!eventId || !EVENT_ID_RE.test(eventId)) return null;
  if (!inboxId || !INBOX_ID_RE.test(inboxId)) return null;
  if (!messageId || !MESSAGE_ID_RE.test(messageId)) return null;
  return { eventId, inboxId, messageId };
}

/**
 * Parses a (signature-verified) inbound webhook body: `{events: [...]}`, a bare array, or JSON Lines.
 * Returns null when the body isn't valid JSON or an inbound event is malformed; other event types are
 * counted as ignored.
 */
export function parseMailtrapInboundWebhook(rawBody: string): { events: InboundEvent[]; ignored: number } | null {
  const chunks: unknown[] = [];
  try {
    chunks.push(JSON.parse(rawBody));
  } catch {
    for (const line of rawBody.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        chunks.push(JSON.parse(line));
      } catch {
        return null;
      }
    }
  }
  const raw: unknown[] = [];
  for (const chunk of chunks) {
    if (Array.isArray(chunk)) raw.push(...chunk);
    else if (chunk && typeof chunk === "object" && Array.isArray((chunk as { events?: unknown }).events)) raw.push(...(chunk as { events: unknown[] }).events);
    else raw.push(chunk);
  }
  if (raw.length === 0 || raw.length > MAX_INBOUND_EVENTS) return null;
  const events: InboundEvent[] = [];
  let ignored = 0;
  for (const r of raw) {
    const e = readEvent(r);
    if (e === null) return null;
    if (e === "ignored") ignored++;
    else events.push(e);
  }
  return { events, ignored };
}

// ---------------------------------------------------------------- the Messages API

export type InboundFetchResult = { ok: true; message: unknown } | { ok: false; status: number; retryable: boolean };

/** Reads one inbound message (the parsed JSON) with an API token that can read the inbox. */
export async function fetchInboundMessage(opts: {
  token: string;
  inboxId: string;
  messageId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<InboundFetchResult> {
  if (!INBOX_ID_RE.test(opts.inboxId) || !MESSAGE_ID_RE.test(opts.messageId)) return { ok: false, status: 400, retryable: false };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000) : undefined;
  try {
    const res = await fetchImpl(`${MAILTRAP_INBOUND_API}/inboxes/${opts.inboxId}/messages/${opts.messageId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
      signal: controller?.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      try {
        return { ok: true, message: await res.json() };
      } catch {
        return { ok: false, status: 502, retryable: true };
      }
    }
    // A message that is gone (deleted from the inbox) won't come back; everything else may.
    return { ok: false, status: res.status, retryable: res.status !== 404 && res.status !== 400 };
  } catch {
    return { ok: false, status: 0, retryable: true };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- addresses

/** `Name <a@b.c>`, `<a@b.c>`, `a@b.c` or `{name, email}` → the lowercased address and the name. */
export function parseAddress(value: unknown): { address: string; name: string } | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const address = str(o.email) ?? str(o.address);
    return address ? parseAddress(o.name ? `${String(o.name)} <${address}>` : address) : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 400);
  const angled = /<([^<>\s]+)>\s*$/.exec(text);
  const address = (angled ? angled[1]! : text).trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return null;
  const name = angled
    ? text
        .slice(0, angled.index)
        .trim()
        .replace(/^"(.*)"$/, "$1")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 80)
    : "";
  return { address, name };
}

function addressList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/) : [];
  const out: string[] = [];
  for (const item of items.slice(0, 50)) {
    const a = parseAddress(item);
    if (a) out.push(a.address);
  }
  return out;
}

// ---------------------------------------------------------------- text

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A plain-text reading of an HTML body: no tags, no quoted blocks, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .slice(0, 500_000)
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi, "")
    .replace(/<div\b[^>]*class="[^"]*(gmail_quote|moz-cite-prefix|OutlookMessageHeader)[^"]*"[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_HEADER = [
  /^On .{1,400} wrote:\s*$/i,
  /^Le .{1,400} a écrit\s*:\s*$/i,
  /^Am .{1,400} schrieb .{1,200}:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
];

/**
 * The new part of a reply: everything before the first quote header ("On … wrote:", "-----Original
 * Message-----", Outlook's rule plus "From:"), without lines quoted with ">". Falls back to the whole
 * text when that leaves nothing.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    // "On Tue, 3 Sep 2026 at 10:00, Folevi Support <support@folevi.com>" + "wrote:" on the next line.
    const joined = `${trimmed} ${lines[i + 1]?.trim() ?? ""}`;
    if (QUOTE_HEADER.some((re) => re.test(trimmed)) || (/^On\s/i.test(trimmed) && /^On .{1,400} wrote:\s*$/i.test(joined))) break;
    if (/^From:\s/i.test(trimmed) && kept.length > 0 && (kept.at(-1)!.trim() === "" || /^_{10,}$/.test(kept.at(-1)!.trim()))) break;
    if (/^>/.test(trimmed)) continue;
    kept.push(line);
  }
  const out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || text.trim();
}

/** The ticket number in a subject tagged like "[Folevi #1042]", else null. */
export function ticketNumberFromSubject(subject: string): number | null {
  const m = /\[Folevi #(\d{1,9})\]/i.exec(subject);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const AUTOMATED_SUBJECT = /^(auto(matic)?[ -]?(reply|response)|out of (the )?office|undeliver(able|ed)|delivery (status notification|failure|has failed)|mail delivery (failed|subsystem)|returned mail|failure notice)\b/i;
const AUTOMATED_SENDER = /^(mailer-daemon|postmaster|mail-daemon|bounce|bounces)(\+.*)?@/i;

/**
 * Why a message looks automatic (an auto-reply, a bounce, a bulk mailing), or null for a person's mail.
 * Replying to those would start a mail loop, so they never become ticket messages.
 */
export function automatedReason(message: { headers: Record<string, string>; fromAddress: string; subject: string }): string | null {
  const h = message.headers;
  const autoSubmitted = h["auto-submitted"]?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "auto_submitted";
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-autoresponder"]) return "auto_reply_header";
  const precedence = h.precedence?.trim().toLowerCase();
  if (precedence && ["bulk", "junk", "list", "auto_reply"].includes(precedence)) return "precedence";
  if (h["x-failed-recipients"]) return "bounce";
  if (h["return-path"] !== undefined && h["return-path"].trim() === "<>") return "bounce";
  if (/multipart\/report/i.test(h["content-type"] ?? "")) return "bounce";
  if (AUTOMATED_SENDER.test(message.fromAddress)) return "mailer_daemon";
  if (AUTOMATED_SUBJECT.test(message.subject.trim())) return "auto_reply_subject";
  return null;
}

export interface InboundMessage {
  /** Lowercased sender address. */
  fromAddress: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  /** The new text of the message (plain text, else the HTML as text), quotes stripped, capped. */
  text: string;
  /** The RFC 5322 Message-ID, without brackets, when present. */
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Set when the message is an auto-reply, bounce or bulk mail (see automatedReason). */
  automated: string | null;
}

function msgId(value: unknown): string | null {
  const s = str(value)?.trim().replace(/^<|>$/g, "");
  return s && s.length <= 250 && /^[\x21-\x3b\x3d\x3f-\x7e]+$/.test(s) ? s : null;
}

/** Reads the fields support needs from a Messages API response. Null when there's no usable sender. */
export function readInboundMessage(raw: unknown): InboundMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const from = parseAddress(m.from) ?? parseAddress(m.reply_to);
  if (!from) return null;
  const headers: Record<string, string> = {};
  if (m.headers && typeof m.headers === "object" && !Array.isArray(m.headers)) {
    for (const [k, v] of Object.entries(m.headers as Record<string, unknown>).slice(0, 200)) {
      const value = str(v) ?? (Array.isArray(v) ? v.map(str).filter(Boolean).join(", ") : undefined);
      if (value !== undefined) headers[k.toLowerCase()] = value.slice(0, 1000);
    }
  }
  const subject = (str(m.subject) ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_INBOUND_SUBJECT);
  const plain = str(m.text_body) ?? str(m.text) ?? "";
  const html = str(m.html_body) ?? str(m.html) ?? "";
  const source = plain.trim() ? plain.slice(0, 200_000) : htmlToText(html);
  const text = stripQuotedReply(source)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, MAX_INBOUND_TEXT)
    .trim();
  const references = (Array.isArray(m.references) ? m.references : typeof m.references === "string" ? m.references.split(/\s+/) : [])
    .map(msgId)
    .filter((r): r is string => r !== null)
    .slice(-20);
  return {
    fromAddress: from.address,
    fromName: from.name,
    to: addressList(m.to),
    cc: addressList(m.cc),
    subject,
    text,
    rfcMessageId: msgId(m.rfc_message_id) ?? msgId(m.message_id) ?? msgId(headers["message-id"]),
    inReplyTo: msgId(m.in_reply_to) ?? msgId(headers["in-reply-to"]),
    references,
    automated: automatedReason({ headers, fromAddress: from.address, subject }),
  };
}
