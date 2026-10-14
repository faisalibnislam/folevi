// Email to note: the rules shared by convex/emailNotes.ts and the Resend webhook (convex/http.ts).
//
// A person's address is n-<token>@folevi.com. The token is 24 characters from a 32-letter lowercase
// alphabet (120 random bits), so it can't be guessed; the webhook routes on the "n-" local part.
import { markdownToBlocks, rankSequence, SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";
import type { MailAuthentication } from "@folevi/email";
import type { MutationCtx } from "../_generated/server";

export const NOTE_DOMAIN = "folevi.com";
/** n-<token>@folevi.com, any case (mail clients may change it). */
const NOTE_ADDRESS_RE = /^n-([a-z0-9]{16,40})@folevi\.com$/i;
/** Lowercase letters and digits without the look-alikes (0/o, 1/l), so an address read aloud survives. */
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 24;

export const EMAIL_NOTE_LIMITS = {
  /** Addresses besides the account's own that may add notes. */
  extraSenders: 5,
  /** Blocks a note made from an email may have (the rest is cut, and the note says so). */
  maxBlocks: 1000,
  /** A notice about ignored mail (or the daily limit) at most this often. */
  noticeEveryMs: 24 * 60 * 60_000,
} as const;

/** A new random token for an address. */
export function newNoteToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so taking each byte modulo 32 is uniform.
  return [...bytes].map((b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join("");
}

export const noteAddress = (token: string) => `n-${token}@${NOTE_DOMAIN}`;

/** The token of an email-to-note address (lowercased), or null for any other address. */
export function noteTokenOf(address: string): string | null {
  const m = NOTE_ADDRESS_RE.exec(address.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Whether Resend's receiving server confirmed the From address: DMARC must pass (an aligned SPF or DKIM
 * pass for the From domain). Gmail, Outlook, iCloud and most providers sign their mail so it does. With
 * no results at all (older messages), or anything but a pass, the mail is treated as unverified.
 */
export function fromIsVerified(auth: MailAuthentication | null): boolean {
  return auth?.dmarc === "pass";
}

/** "14 Oct 2026, 09:12" in the person's time zone. */
export function receivedLabel(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace("T", " ");
  }
}

const paragraph = (text: string): WireBlock => ({ id: ulid(), type: "paragraph", parentId: null, rank: "", schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props: {} });

/**
 * The blocks of a note made from an email: where it came from ("From jane@example.com, 14 Oct 2026,
 * 09:12"), the text (read as Markdown, so lists, quotes and links come across; images that point at the
 * web are left out, so opening the note never loads them), then the attachments that weren't imported
 * and a line when the email was cut.
 */
export function emailNoteBlocks(input: { fromAddress: string; fromName: string; receivedAt: number; timeZone: string; text: string; truncated: boolean; attachments: string[] }): WireBlock[] {
  const who = input.fromName && input.fromName.toLowerCase() !== input.fromAddress ? `${input.fromName} (${input.fromAddress})` : input.fromAddress;
  const top: WireBlock[] = [paragraph(`From ${who}, ${receivedLabel(input.receivedAt, input.timeZone)}`)];
  const { blocks } = markdownToBlocks(input.text, { titleFromHeading: false, lineBreaks: true });
  const dropped = new Set(blocks.filter((b) => b.type === "image").map((b) => b.id));
  let content = blocks.filter((b) => !dropped.has(b.id) && !(b.parentId && dropped.has(b.parentId)));
  let truncated = input.truncated;
  if (content.length > EMAIL_NOTE_LIMITS.maxBlocks) {
    // Cut at a top-level block, so no child is left without its parent.
    const keep = new Set<string>();
    for (const b of content) {
      if (keep.size >= EMAIL_NOTE_LIMITS.maxBlocks) break;
      if (b.parentId === null || keep.has(b.parentId)) keep.add(b.id);
    }
    content = content.filter((b) => keep.has(b.id));
    truncated = true;
  }
  const tail: WireBlock[] = [];
  if (input.attachments.length) tail.push(paragraph(`Attachments not imported: ${input.attachments.join(", ")}`));
  if (truncated) tail.push(paragraph("This email was too long to save in full."));
  const all = [...top, ...content, ...tail];
  const roots = all.filter((b) => b.parentId === null);
  const ranks = rankSequence(roots.length);
  roots.forEach((b, i) => (b.rank = ranks[i]!));
  return all;
}

/** Receipts older than this are dropped (Resend retries for about a day; duplicates come sooner). */
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** Housekeeping (maintenance.housekeeping): old receipts. Returns whether more are left. */
export async function purgeOldReceipts(ctx: MutationCtx, now: number): Promise<boolean> {
  const rows = await ctx.db
    .query("emailNoteReceipts")
    .withIndex("by_created", (q) => q.lt("createdAt", now - RECEIPT_RETENTION_MS))
    .take(500);
  for (const r of rows) await ctx.db.delete(r._id);
  return rows.length === 500;
}
