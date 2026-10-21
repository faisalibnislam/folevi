// Email to note: a private address, n-<token>@folevi.com, that turns mail into notes in the person's Inbox
// (Settings > Import & export). Mail reaches Resend's receiving for folevi.com like support@ does, and the
// Resend webhook (http.ts) hands anything for an n- address to `receiveNoteMail` below.
//
//   status, create, rotate, remove: the address. One per person; a new one ends the old one at once.
//   setPlace:                       where notes go: Personal, or a workspace where the person can add pages
//                                   (if that stops being true, notes go to Personal).
//   addSender, removeSender:        up to 5 addresses besides the account's own that may send. The
//                                   account's own address always may (and isn't stored, so it follows a
//                                   change of address); it can't be removed.
//   receive:                        files one message. Only mail whose From is an allowed sender AND that
//                                   Resend's receiving server verified for that address (DMARC pass) becomes
//                                   a note; anything else is ignored and counted, with a notice in the bell at
//                                   most once a day. 50 notes a day per address; a message is saved once
//                                   (Resend email id, then Message-ID).
//
// The token is stored as it is (see schema.ts): an email address can't be shown once like the calendar
// link, and it's in the headers of every message sent to it anyway. The sender check is the gate.
// Attachments aren't imported (their names are listed at the end of the note); Resend keeps them.
// Logs carry outcomes only, never addresses, subjects or text.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { fetchReceivedEmail, readNoteEmail } from "@folevi/email";
import { assertWritable, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { vScopeArg } from "./lib/scope";
import { isEmail, normalizeEmail } from "./lib/support";
import { EMAIL_NOTE_LIMITS, emailNoteBlocks, fromIsVerified, newNoteToken, noteAddress } from "./lib/emailNotes";
import { placeOf, saveToInbox } from "./aiDigest";
import { ulid } from "@folevi/editor-schema";
import { spaceE2ee, switchesOf } from "./lib/e2ee/state";
import { inboxItem, sealToInbox, stableInboxId } from "./lib/e2ee/inboxSeal";

type Ctx = QueryCtx | MutationCtx;

const addressOf = (ctx: Ctx, profileId: Id<"profiles">) =>
  ctx.db
    .query("emailNoteAddresses")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .first();

/** A token no address has. */
async function freshToken(ctx: MutationCtx): Promise<string> {
  for (;;) {
    const token = newNoteToken();
    const taken = await ctx.db
      .query("emailNoteAddresses")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!taken) return token;
  }
}

// ---------------------------------------------------------------------------------------------------
// Settings > Import & export
// ---------------------------------------------------------------------------------------------------

/** The person's address and its settings, or null when they have none. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const row = await addressOf(ctx, profile._id);
    if (!row) return null;
    let place: { kind: "personal" } | { kind: "workspace"; workspaceId: string; name: string } = { kind: "personal" };
    if (row.workspaceId && (await placeOf(ctx, profile, row.workspaceId))) {
      const ws = (await ctx.db.get(row.workspaceId))!;
      place = { kind: "workspace", workspaceId: ws.publicId, name: ws.name };
    }
    return {
      address: noteAddress(row.token),
      place,
      ownAddress: normalizeEmail(profile.email),
      extraSenders: row.extraSenders,
      count: row.count,
      lastReceivedAt: row.lastReceivedAt ?? null,
      rejectedCount: row.rejectedCount,
      lastRejectedAt: row.lastRejectedAt ?? null,
      createdAt: row.createdAt,
    };
  },
});

/** Makes the person's address (or returns the one they have). Notes go to their Personal unless `scope` says otherwise. */
export const create = mutation({
  args: { scope: v.optional(vScopeArg) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const existing = await addressOf(ctx, profile._id);
    if (existing) return { address: noteAddress(existing.token) };
    let workspaceId: Id<"workspaces"> | undefined;
    if (args.scope) {
      const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
      workspaceId = scope.kind === "workspace" ? scope.workspaceId : undefined;
    }
    const token = await freshToken(ctx);
    await ctx.db.insert("emailNoteAddresses", { profileId: profile._id, token, ...(workspaceId ? { workspaceId } : {}), extraSenders: [], createdAt: Date.now(), count: 0, rejectedCount: 0 });
    return { address: noteAddress(token) };
  },
});

/** A new address; the old one stops working at once. */
export const rotate = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await addressOf(ctx, profile._id);
    if (!row) fail("not_found", "You don't have an address yet.");
    const token = await freshToken(ctx);
    await ctx.db.patch(row._id, { token, rotatedAt: Date.now() });
    return { address: noteAddress(token) };
  },
});

/** Turns email to note off: the address stops working. Notes already made stay. */
export const remove = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("emailNoteAddresses")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return null;
  },
});

/** Where notes go: Personal, or a workspace where the person can add pages. */
export const setPlace = mutation({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await addressOf(ctx, profile._id);
    if (!row) fail("not_found", "You don't have an address yet.");
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    await ctx.db.patch(row._id, { workspaceId: scope.kind === "workspace" ? scope.workspaceId : undefined });
    return null;
  },
});

/** Lets another of the person's addresses send notes (at most 5 besides the account's own). */
export const addSender = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await addressOf(ctx, profile._id);
    if (!row) fail("not_found", "You don't have an address yet.");
    const email = normalizeEmail(args.email);
    if (!isEmail(email)) fail("invalid_argument", "Enter an email address.", { field: "email" });
    if (email === normalizeEmail(profile.email) || row.extraSenders.includes(email)) return null;
    if (row.extraSenders.length >= EMAIL_NOTE_LIMITS.extraSenders) fail("limit_exceeded", `You can add up to ${EMAIL_NOTE_LIMITS.extraSenders} other addresses.`);
    await ctx.db.patch(row._id, { extraSenders: [...row.extraSenders, email] });
    return null;
  },
});

/** Stops another address from sending notes. The account's own address can't be removed. */
export const removeSender = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const row = await addressOf(ctx, profile._id);
    if (!row) return null;
    const email = normalizeEmail(args.email);
    if (email === normalizeEmail(profile.email)) fail("invalid_argument", "Your account's own address can always send notes.");
    await ctx.db.patch(row._id, { extraSenders: row.extraSenders.filter((s) => s !== email) });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------------------------------

/** The tokens (of those given) that belong to an address and haven't filed this email yet. */
export const pending = internalQuery({
  args: { tokens: v.array(v.string()), emailId: v.string() },
  handler: async (ctx, args) => {
    const filed = await ctx.db
      .query("emailNoteReceipts")
      .withIndex("by_email", (q) => q.eq("emailId", args.emailId))
      .collect();
    const out: string[] = [];
    for (const token of args.tokens.slice(0, 5)) {
      const row = await ctx.db
        .query("emailNoteAddresses")
        .withIndex("by_token", (q) => q.eq("token", token))
        .first();
      if (row && !filed.some((f) => f.addressId === row._id)) out.push(token);
    }
    return out;
  },
});

const vAuthCheck = v.union(v.literal("pass"), v.literal("fail"), v.literal("gray"), v.literal("processing_failed"), v.literal("unknown"));

type Outcome = "saved" | "queued" | "unknown" | "duplicate" | "inactive" | "rejected_sender" | "rejected_unverified" | "rejected_e2ee" | "rate_limited";

/** The notice when mail reaches an encrypted space that doesn't take email (docs/E2EE_DESIGN.md §5.7). */
export const E2EE_NO_EMAIL = "We ignored an email to your Folevi address: this Folevi space is end-to-end encrypted and doesn't accept email. Turn on Email to note in Settings > Privacy to receive it.";

/** A notice in the person's bell, at most once a day for each kind. */
async function notice(ctx: MutationCtx, row: Doc<"emailNoteAddresses">, field: "lastRejectNoticeAt" | "lastLimitNoticeAt", title: string): Promise<void> {
  const last = row[field];
  if (last !== undefined && Date.now() - last < EMAIL_NOTE_LIMITS.noticeEveryMs) return;
  await ctx.db.insert("notifications", { profileId: row.profileId, kind: "system", title, createdAt: Date.now() });
  await ctx.db.patch(row._id, { [field]: Date.now() });
}

/** Files one email for one address (already fetched and parsed by `receiveNoteMail`). */
export const receive = internalMutation({
  args: {
    token: v.string(),
    emailId: v.string(),
    fromAddress: v.string(),
    fromName: v.string(),
    subject: v.string(),
    text: v.string(),
    truncated: v.boolean(),
    rfcMessageId: v.union(v.string(), v.null()),
    receivedAt: v.union(v.number(), v.null()),
    attachments: v.array(v.string()),
    authentication: v.union(v.object({ spf: vAuthCheck, dkim: vAuthCheck, dmarc: vAuthCheck }), v.null()),
  },
  handler: async (ctx, args): Promise<{ outcome: Outcome; documentId?: string }> => {
    const row = await ctx.db
      .query("emailNoteAddresses")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) return { outcome: "unknown" };
    const filed = await ctx.db
      .query("emailNoteReceipts")
      .withIndex("by_email", (q) => q.eq("emailId", args.emailId))
      .collect();
    if (filed.some((f) => f.addressId === row._id)) return { outcome: "duplicate" };
    if (args.rfcMessageId) {
      const same = await ctx.db
        .query("emailNoteReceipts")
        .withIndex("by_address_message", (q) => q.eq("addressId", row._id).eq("rfcMessageId", args.rfcMessageId!))
        .first();
      if (same) return { outcome: "duplicate" };
    }
    const profile = await ctx.db.get(row.profileId);
    if (!profile || profile.status !== "active") return { outcome: "inactive" };

    const from = normalizeEmail(args.fromAddress);
    const allowed = from === normalizeEmail(profile.email) || row.extraSenders.includes(from);
    const verified = fromIsVerified(args.authentication);
    if (!allowed || !verified) {
      const shown = from.slice(0, 120);
      await ctx.db.patch(row._id, { rejectedCount: row.rejectedCount + 1, lastRejectedAt: Date.now() });
      await notice(
        ctx,
        row,
        "lastRejectNoticeAt",
        allowed
          ? `We ignored an email to your Folevi address from ${shown} because we couldn't confirm it really came from that address.`
          : `We ignored an email to your Folevi address from ${shown}. Only your own address can add notes.`,
      );
      return { outcome: allowed ? "rejected_unverified" : "rejected_sender" };
    }

    try {
      await consume(ctx, "emailNote", row._id);
    } catch {
      await notice(ctx, row, "lastLimitNoticeAt", "Your Folevi email address took in 50 emails today, its daily limit. Emails after that weren't saved.");
      return { outcome: "rate_limited" };
    }

    const place = (await placeOf(ctx, profile, row.workspaceId)) ?? (await placeOf(ctx, profile, undefined))!;
    const receivedAt = args.receivedAt ?? Date.now();
    const title = args.subject.trim() || `Email from ${from}`;
    const blocks = emailNoteBlocks({ fromAddress: from, fromName: args.fromName, receivedAt, timeZone: profile.timeZone, text: args.text, truncated: args.truncated, attachments: args.attachments });

    // An encrypted space: the mail is sealed to the space's inbox key and a device makes the note (§7.5).
    // Nothing of it is stored readable; the address's counts and the bell's notice carry no content.
    const space = await spaceE2ee(ctx, place.scope);
    if (space && space.level !== "standard") {
      if (!switchesOf(space).emailToNote) {
        await notice(ctx, row, "lastRejectNoticeAt", E2EE_NO_EMAIL);
        return { outcome: "rejected_e2ee" };
      }
      // One item per message and address: a delivery Resend retries finds the one already stored.
      const publicId = await stableInboxId("email-", row._id, args.emailId);
      if (await inboxItem(ctx, publicId)) return { outcome: "duplicate" };
      const documentId = ulid();
      await sealToInbox(
        ctx,
        place.scope,
        "email",
        { kind: "email", subject: title, from: { address: from, name: args.fromName }, receivedAt, blocks, attachments: args.attachments, documentId },
        { publicId, for: profile._id, targetDocumentId: documentId },
      );
      await ctx.db.patch(row._id, { count: row.count + 1, lastReceivedAt: Date.now() });
      await ctx.db.insert("notifications", {
        profileId: profile._id,
        ...(place.scope.kind === "workspace" ? { workspaceId: place.scope.workspaceId } : {}),
        kind: "system",
        title: "An email arrived for your Inbox. It's added when one of your devices opens Folevi.",
        createdAt: Date.now(),
      });
      return { outcome: "queued", documentId };
    }
    const doc = await saveToInbox(ctx, profile, place, title, blocks);
    await ctx.db.insert("emailNoteReceipts", { addressId: row._id, profileId: profile._id, emailId: args.emailId, ...(args.rfcMessageId ? { rfcMessageId: args.rfcMessageId } : {}), documentId: doc._id, createdAt: Date.now() });
    await ctx.db.patch(row._id, { count: row.count + 1, lastReceivedAt: Date.now() });
    await ctx.db.insert("notifications", {
      profileId: profile._id,
      ...(place.scope.kind === "workspace" ? { workspaceId: place.scope.workspaceId } : {}),
      kind: "system",
      documentId: doc._id,
      title: `An email became a note in your Inbox: ${doc.title || title}`.slice(0, 300),
      createdAt: Date.now(),
    });
    return { outcome: "saved", documentId: doc.publicId };
  },
});

/**
 * The webhook's part (http.ts): an `email.received` event for one or more n- addresses. Addresses that
 * don't exist (or already filed this email) are skipped without reading the message. Otherwise the message
 * is fetched once from Resend's Received emails API and filed for each address. "retry" asks Resend to
 * deliver the event again (no API key, or Resend's API unreachable).
 */
export async function receiveNoteMail(ctx: ActionCtx, emailId: string, tokens: string[], fetchMessage: () => ReturnType<typeof fetchReceivedEmail>): Promise<"done" | "retry"> {
  const log = (outcome: string) => console.log(JSON.stringify({ event: "email_note.inbound", provider: "resend", outcome }));
  const live = await ctx.runQuery(internal.emailNotes.pending, { tokens, emailId });
  if (live.length === 0) {
    log("unknown_or_duplicate");
    return "done";
  }
  const fetched = await fetchMessage();
  if (!fetched.ok) {
    log(`fetch_${fetched.status}`);
    return fetched.retryable ? "retry" : "done";
  }
  const message = readNoteEmail(fetched.message);
  if (!message) {
    log("unreadable");
    return "done";
  }
  for (const token of live) {
    const result = await ctx.runMutation(internal.emailNotes.receive, {
      token,
      emailId,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      subject: message.subject,
      text: message.text,
      truncated: message.truncated,
      rfcMessageId: message.rfcMessageId,
      receivedAt: message.receivedAt,
      attachments: message.attachments,
      authentication: message.authentication,
    });
    log(result.outcome);
  }
  return "done";
}
