// Inbound email: reading a message Resend received, and turning it into plain support text or into the
// text of a note (email to note, convex/emailNotes.ts).
//
// Resend posts `email.received` webhooks (resendWebhook.ts) carrying only the email id; the message itself
// is read from
//   GET https://api.resend.com/emails/receiving/{id}
// which returns the parsed message (from, to, cc, subject, text, html, headers, message_id, the
// attachments' names and sizes, and the SPF/DKIM/DMARC results). See docs/SUPPORT.md. The text helpers
// below don't depend on the provider.
//
// Nothing here logs, and nothing returns more of a message than the caller asked for.
import { RESEND_API } from "./resend";

/** Stored message text is capped (characters, after quote stripping). */
export const MAX_INBOUND_TEXT = 20_000;
export const MAX_INBOUND_SUBJECT = 200;

const EMAIL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

// ---------------------------------------------------------------- the Received emails API

export type InboundFetchResult = { ok: true; message: unknown } | { ok: false; status: number; retryable: boolean };

/** Reads one received email (the parsed JSON) with a Resend API key that has full access. */
export async function fetchReceivedEmail(opts: {
  apiKey: string;
  emailId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<InboundFetchResult> {
  if (!EMAIL_ID_RE.test(opts.emailId)) return { ok: false, status: 400, retryable: false };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000) : undefined;
  try {
    const res = await fetchImpl(`${RESEND_API}/emails/receiving/${opts.emailId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
      signal: controller?.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      try {
        return { ok: true, message: await res.json() };
      } catch {
        return { ok: false, status: 502, retryable: true };
      }
    }
    // A message that is gone won't come back; everything else may.
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
const ENTITY_RE = /&(#x?[0-9a-f]+|[a-z]+);/gi;

function decodeEntity(m: string, code: string): string {
  if (code[0] === "#") {
    const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
  }
  return ENTITIES[code.toLowerCase()] ?? m;
}

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
    .replace(ENTITY_RE, decodeEntity)
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

/** Reads the fields support needs from a Received emails API response. Null when there's no usable sender. */
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
  const rawRefs = m.references ?? headers.references;
  const references = (Array.isArray(rawRefs) ? rawRefs : typeof rawRefs === "string" ? rawRefs.split(/\s+/) : [])
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

// ---------------------------------------------------------------- email to note

/** A note made from an email keeps at most this much text (characters). */
export const MAX_NOTE_TEXT = 100_000;

export type AuthCheck = "pass" | "fail" | "gray" | "processing_failed" | "unknown";

/**
 * SPF, DKIM and DMARC as Resend's receiving server worked them out (the Received emails API's
 * `authentication`). They come from the server, not from the message's headers, so a sender can't forge
 * them. Null when the response has none.
 */
export interface MailAuthentication {
  spf: AuthCheck;
  dkim: AuthCheck;
  dmarc: AuthCheck;
}

export interface NoteEmail {
  /** Lowercased address in the From header (never Reply-To: the sender check is on From). */
  fromAddress: string;
  fromName: string;
  subject: string;
  /** The whole message as Markdown-style text: the plain-text part, else the HTML with links kept. Quotes and forwarded parts stay. */
  text: string;
  /** The text was cut at MAX_NOTE_TEXT. */
  truncated: boolean;
  rfcMessageId: string | null;
  /** When Resend received it (ms), when the response says. */
  receivedAt: number | null;
  /** File names of the attachments (not inline images), for the note to list. */
  attachments: string[];
  authentication: MailAuthentication | null;
}

const AUTH_CHECKS = new Set<AuthCheck>(["pass", "fail", "gray", "processing_failed", "unknown"]);

function authCheck(value: unknown): AuthCheck {
  const s = str(value)?.trim().toLowerCase();
  return s && AUTH_CHECKS.has(s as AuthCheck) ? (s as AuthCheck) : "unknown";
}

/** `[label](href)` for an http(s) or mailto link; the label alone for anything else. */
function markdownLink(rawHref: string, rawLabel: string): string {
  const href = rawHref.replace(ENTITY_RE, decodeEntity).trim();
  const label = rawLabel
    .replace(/<[^>]*>/g, "")
    .replace(ENTITY_RE, decodeEntity)
    .replace(/\s+/g, " ")
    .trim();
  if (!/^(https?:\/\/|mailto:)/i.test(href) || href.length > 2000) return label;
  const target = href.replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  const text = (label || href).replace(/([[\]\\])/g, "\\$1");
  return `[${text}](${target})`;
}

/**
 * An HTML email body as Markdown-style text for a note: paragraphs and line breaks kept, list items as
 * "- ", links as [text](url) (http, https and mailto only), images, styles and scripts dropped. Unlike
 * htmlToText, quoted and forwarded parts stay: forwarding a message is the point.
 */
export function htmlToNoteText(html: string): string {
  return html
    .slice(0, 1_000_000)
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, d?: string, s?: string, u?: string, inner?: string) => markdownLink(d ?? s ?? u ?? "", inner ?? ""))
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|h[1-6]|blockquote|ul|ol|table|pre)\b[^>]*>/gi, "\n\n")
    .replace(/<\/(div|tr)\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(ENTITY_RE, decodeEntity)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Reads what a note needs from a Received emails API response. Null when there's no usable From address. */
export function readNoteEmail(raw: unknown): NoteEmail | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const from = parseAddress(m.from);
  if (!from) return null;
  const subject = (str(m.subject) ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_INBOUND_SUBJECT);
  const plain = str(m.text_body) ?? str(m.text) ?? "";
  const html = str(m.html_body) ?? str(m.html) ?? "";
  const source = plain.trim() ? plain.slice(0, MAX_NOTE_TEXT * 2) : htmlToNoteText(html);
  const clean = source
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  const attachments: string[] = [];
  if (Array.isArray(m.attachments)) {
    for (const a of m.attachments.slice(0, 50)) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      if (str(o.content_disposition)?.toLowerCase() === "inline" && str(o.content_id)) continue;
      const name = (str(o.filename) ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
      attachments.push(name || "unnamed file");
    }
  }
  let authentication: MailAuthentication | null = null;
  if (m.authentication && typeof m.authentication === "object" && !Array.isArray(m.authentication)) {
    const a = m.authentication as Record<string, unknown>;
    authentication = { spf: authCheck(a.spf), dkim: authCheck(a.dkim), dmarc: authCheck(a.dmarc) };
  }
  const created = Date.parse(str(m.created_at) ?? "");
  return {
    fromAddress: from.address,
    fromName: from.name,
    subject,
    text: clean.slice(0, MAX_NOTE_TEXT),
    truncated: clean.length > MAX_NOTE_TEXT,
    rfcMessageId: msgId(m.rfc_message_id) ?? msgId(m.message_id),
    receivedAt: Number.isFinite(created) ? created : null,
    attachments,
    authentication,
  };
}
