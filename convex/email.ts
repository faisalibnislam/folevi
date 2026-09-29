import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { emailManifest, hashRecipient, redactEmail, sendTransactional, transactionalIdFor, type TemplateKey } from "@folevi/email";
import { ulid } from "@folevi/editor-schema";
import type { Id } from "./_generated/dataModel";
import { bump } from "./lib/metrics";

type Environment = "production" | "preview" | "development" | "test";

function environment(): Environment {
  const env = process.env.FOLEVI_ENV;
  return env === "production" || env === "preview" || env === "test" ? env : "development";
}

const vTemplateKey = v.string();

/** Notices whose variables contain no one-time links or user-written content may be replayed by admins. */
const RESENDABLE = new Set(["security_new_device", "account_deletion_scheduled"]);

/** Templates that the daily digest replaces for people who chose it (never both). */
const DIGESTED = new Set<string>(["mention_notification", "comment_notification"]);

/**
 * Finer preferences a template may be sent under instead of its manifest `preferenceKey`, with the key
 * they fall back to while unset (a reply uses the comment email but has its own switch). Anything not
 * listed here is ignored, so a caller can never pick a looser preference.
 */
const REFINED_PREFERENCES: Record<string, Record<string, string>> = {
  comment_notification: { replies: "comments" },
  access_changed: { access: "shares" },
};

/**
 * Folevi-side preference check for product email. Mirrors lib/notify.ts#wantsImmediateEmail and is
 * enforced here again so no caller can bypass it.
 */
export function productEmailAllowed(key: string, preferenceKey: string, prefs: Record<string, unknown>, refined?: string): boolean {
  if (preferenceKey === "digest") return prefs.digest === "daily";
  const fallback = refined ? REFINED_PREFERENCES[key]?.[refined] : undefined;
  const choice = fallback ? (prefs[refined!] ?? prefs[fallback]) : prefs[preferenceKey];
  if (choice === false) return false;
  if (DIGESTED.has(key) && prefs.digest === "daily") return false;
  return true;
}

/** Loops reports webhook `eventTime` in seconds; everything Folevi stores is milliseconds. */
export function eventTimeMs(t: number): number {
  return t < 1e12 ? Math.round(t * 1000) : t;
}

/**
 * Sends one transactional email through Loops. Records every attempt locally; a 200 from Loops is
 * recorded as "accepted" (accepted by provider), never as "delivered".
 */
export const sendTemplate = internalAction({
  args: {
    key: vTemplateKey,
    profileId: v.optional(v.id("profiles")),
    to: v.optional(v.string()),
    dataVariables: v.record(v.string(), v.union(v.string(), v.number())),
    idempotencyKey: v.string(),
    resendOf: v.optional(v.id("emailSendAttempts")),
    /** A finer preference for this send (see REFINED_PREFERENCES), e.g. "replies" for a reply's comment email. */
    preference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = args.key as TemplateKey;
    const def = emailManifest[key];
    if (!def) throw new Error(`unknown template ${args.key}`);
    let to = args.to ?? null;
    let profileId = args.profileId;
    if (!profileId && to) {
      // Mail addressed by email (identity mail, invitations) is linked to the account when one exists,
      // so it shows on the admin user page and product mail still honors that person's preferences.
      const linked = await ctx.runQuery(internal.email.profileByEmail, { email: to });
      if (linked) {
        profileId = linked.profileId;
        if (def.category === "product" && def.preferenceKey && !productEmailAllowed(key, def.preferenceKey, linked.prefs, args.preference)) return { status: "skipped" as const };
      }
    }
    if (args.profileId) {
      const recipient = await ctx.runQuery(internal.users.getForEmail, { profileId: args.profileId });
      if (!recipient || recipient.status === "deleted") return { status: "skipped" as const };
      to = recipient.email;
      // Product notifications honor Folevi-side preferences; security/identity mail is never suppressible.
      if (def.category === "product" && def.preferenceKey) {
        if (!productEmailAllowed(key, def.preferenceKey, recipient.prefs as Record<string, unknown>, args.preference)) return { status: "skipped" as const };
      }
    }
    if (!to) throw new Error("no recipient");
    const salt = process.env.FOLEVI_HASH_SALT ?? "folevi-development-salt";
    const recipientHash = await hashRecipient(to, salt);
    const requestId = ulid();
    const attempt = await ctx.runMutation(internal.email.beginAttempt, {
      templateKey: key,
      category: def.category,
      recipientHash,
      recipientHint: redactEmail(to),
      profileId,
      idempotencyKey: args.idempotencyKey,
      environment: environment(),
      requestId,
      resendOf: args.resendOf,
      resendPayload: RESENDABLE.has(key) ? args.dataVariables : undefined,
      transactionalId: transactionalIdFor(key, process.env as Record<string, string | undefined>) ?? undefined,
    });
    if (attempt.alreadyAccepted) return { status: "accepted" as const, duplicate: true };

    const apiKey = process.env.LOOPS_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.email.finishAttempt, { attemptId: attempt.attemptId, status: "failed", attempts: 0, errorCode: "provider_not_configured" });
      console.warn(JSON.stringify({ event: "email.not_configured", template: key, requestId }));
      return { status: "failed" as const };
    }
    const outcome = await sendTransactional(
      { key, to, dataVariables: args.dataVariables, idempotencyKey: args.idempotencyKey.slice(0, 100) },
      {
        apiKey,
        env: process.env as Record<string, string | undefined>,
        policy: {
          environment: environment(),
          allowlist: (process.env.FOLEVI_EMAIL_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
        },
      },
    );
    await ctx.runMutation(internal.email.finishAttempt, {
      attemptId: attempt.attemptId,
      status: outcome.status,
      attempts: outcome.attempts,
      httpStatus: outcome.httpStatus,
      errorCode: outcome.errorCode,
      providerMessageId: outcome.providerMessageId,
    });
    console.log(
      JSON.stringify({ event: "email.send", template: key, status: outcome.status, attempts: outcome.attempts, code: outcome.errorCode, requestId }),
    );
    return { status: outcome.status };
  },
});

export const beginAttempt = internalMutation({
  args: {
    templateKey: v.string(),
    category: v.string(),
    recipientHash: v.string(),
    recipientHint: v.string(),
    profileId: v.optional(v.id("profiles")),
    idempotencyKey: v.string(),
    environment: v.string(),
    requestId: v.string(),
    resendOf: v.optional(v.id("emailSendAttempts")),
    resendPayload: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
    transactionalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("emailSendAttempts")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existing && existing.status === "accepted" && !args.resendOf) return { attemptId: existing._id, alreadyAccepted: true };
    const now = Date.now();
    const attemptId = await ctx.db.insert("emailSendAttempts", {
      templateKey: args.templateKey,
      category: args.category,
      recipientHash: args.recipientHash,
      recipientHint: args.recipientHint,
      profileId: args.profileId,
      idempotencyKey: args.idempotencyKey,
      status: "queued",
      attempts: 0,
      environment: args.environment,
      requestId: args.requestId,
      createdAt: now,
      updatedAt: now,
      resendOf: args.resendOf,
      resendPayload: args.resendPayload,
      transactionalId: args.transactionalId,
    });
    return { attemptId, alreadyAccepted: false };
  },
});

export const finishAttempt = internalMutation({
  args: {
    attemptId: v.id("emailSendAttempts"),
    status: v.union(v.literal("accepted"), v.literal("failed"), v.literal("skipped")),
    attempts: v.number(),
    httpStatus: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.attemptId, {
      status: args.status,
      attempts: args.attempts,
      httpStatus: args.httpStatus,
      errorCode: args.errorCode,
      providerMessageId: args.providerMessageId,
      updatedAt: Date.now(),
    });
    if (args.status === "failed") await bump(ctx, "email_failed");
    if (args.status === "accepted") await bump(ctx, "email_accepted");
  },
});

/** The active account for an address, if any (only its id and notification preferences). */
export const profileByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .first();
    if (!p || p.status === "deleted") return null;
    return { profileId: p._id, prefs: p.notificationPrefs as Record<string, unknown> };
  },
});

export const getAttempt = internalQuery({
  args: { attemptId: v.id("emailSendAttempts") },
  handler: async (ctx, { attemptId }) => await ctx.db.get(attemptId),
});

/** How far back a webhook event may be matched to a send by recipient + template (delivery can lag). */
const MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Stores a verified Loops webhook event (delivery/bounce/complaint), deduplicated on Webhook-Id, and
 * links it to the send attempt it belongs to: by provider message id when Loops gave us one, otherwise
 * the most recent accepted send to the same (hashed) recipient with the same template before the event.
 */
export const recordProviderEvent = internalMutation({
  args: {
    webhookId: v.string(),
    eventName: v.string(),
    eventTime: v.number(),
    transactionalId: v.optional(v.string()),
    providerEmailId: v.optional(v.string()),
    recipient: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dup = await ctx.db
      .query("emailProviderEvents")
      .withIndex("by_webhook_id", (q) => q.eq("webhookId", args.webhookId))
      .unique();
    if (dup) return { duplicate: true, matched: Boolean(dup.attemptId) };
    const salt = process.env.FOLEVI_HASH_SALT ?? "folevi-development-salt";
    const recipientHash = args.recipient ? await hashRecipient(args.recipient, salt) : undefined;
    const eventTime = eventTimeMs(args.eventTime);
    let attemptId: Id<"emailSendAttempts"> | undefined;
    if (args.providerEmailId) {
      const byId = await ctx.db
        .query("emailSendAttempts")
        .withIndex("by_provider_message", (q) => q.eq("providerMessageId", args.providerEmailId))
        .first();
      attemptId = byId?._id;
    }
    if (!attemptId && recipientHash) {
      const candidates = await ctx.db
        .query("emailSendAttempts")
        .withIndex("by_recipient", (q) => q.eq("recipientHash", recipientHash).gte("createdAt", eventTime - MATCH_WINDOW_MS).lte("createdAt", eventTime + 60_000))
        .order("desc")
        .take(25);
      const match = candidates.find(
        (c) => c.status === "accepted" && (!args.transactionalId || !c.transactionalId || c.transactionalId === args.transactionalId),
      );
      attemptId = match?._id;
    }
    await ctx.db.insert("emailProviderEvents", {
      webhookId: args.webhookId,
      eventName: args.eventName,
      eventTime,
      transactionalId: args.transactionalId,
      providerEmailId: args.providerEmailId,
      recipientHash,
      receivedAt: Date.now(),
      attemptId,
    });
    return { duplicate: false, matched: Boolean(attemptId) };
  },
});
