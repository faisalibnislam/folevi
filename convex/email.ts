import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { emailManifest, hashRecipient, redactEmail, sendTransactional, type TemplateKey } from "@folevi/email";
import { ulid } from "@folevi/editor-schema";
import { bump } from "./lib/metrics";

type Environment = "production" | "preview" | "development" | "test";

function environment(): Environment {
  const env = process.env.FOLEVI_ENV;
  return env === "production" || env === "preview" || env === "test" ? env : "development";
}

const vTemplateKey = v.string();

/** Notices whose variables contain no one-time links or user-written content may be replayed by admins. */
const RESENDABLE = new Set(["security_new_device", "account_deletion_scheduled"]);

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
  },
  handler: async (ctx, args) => {
    const key = args.key as TemplateKey;
    const def = emailManifest[key];
    if (!def) throw new Error(`unknown template ${args.key}`);
    let to = args.to ?? null;
    if (args.profileId) {
      const recipient = await ctx.runQuery(internal.users.getForEmail, { profileId: args.profileId });
      if (!recipient || recipient.status === "deleted") return { status: "skipped" as const };
      to = recipient.email;
      // Product notifications honor Folevi-side preferences; security/identity mail is never suppressible.
      if (def.category === "product" && def.preferenceKey) {
        const prefs = recipient.prefs as Record<string, unknown>;
        const pref = def.preferenceKey === "digest" ? prefs.digest === "daily" : prefs[def.preferenceKey] !== false;
        if (!pref) return { status: "skipped" as const };
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
      profileId: args.profileId,
      idempotencyKey: args.idempotencyKey,
      environment: environment(),
      requestId,
      resendOf: args.resendOf,
      resendPayload: RESENDABLE.has(key) ? args.dataVariables : undefined,
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.attemptId, {
      status: args.status,
      attempts: args.attempts,
      httpStatus: args.httpStatus,
      errorCode: args.errorCode,
      updatedAt: Date.now(),
    });
    if (args.status === "failed") await bump(ctx, "email_failed");
    if (args.status === "accepted") await bump(ctx, "email_accepted");
  },
});

export const getAttempt = internalQuery({
  args: { attemptId: v.id("emailSendAttempts") },
  handler: async (ctx, { attemptId }) => await ctx.db.get(attemptId),
});

/** Stores a verified Loops webhook event (delivery/bounce/complaint). Deduplicated on Webhook-Id. */
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
    if (dup) return;
    const salt = process.env.FOLEVI_HASH_SALT ?? "folevi-development-salt";
    await ctx.db.insert("emailProviderEvents", {
      webhookId: args.webhookId,
      eventName: args.eventName,
      eventTime: args.eventTime,
      transactionalId: args.transactionalId,
      providerEmailId: args.providerEmailId,
      recipientHash: args.recipient ? await hashRecipient(args.recipient, salt) : undefined,
      receivedAt: Date.now(),
    });
  },
});
