// Identity email (verification, password reset) for Better Auth, delivered through Folevi's Loops
// pipeline (`internal.email.sendTemplate`). Outside production every message is also written to a
// local-only "dev mailbox" so people and automated tests can follow the links without a mail
// provider. The dev mailbox is unreadable in production (and never written there).
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { isFeatureEnabled } from "./lib/flags";
import { timingSafeEqualHex } from "./lib/crypto";

const MAILBOX_LIMIT = 200;

function devMailboxEnabled(): boolean {
  return process.env.FOLEVI_ENV !== "production";
}

export const send = internalAction({
  args: {
    key: v.union(v.literal("auth_verify_email"), v.literal("auth_password_reset")),
    to: v.string(),
    actionUrl: v.string(),
    expiresInHours: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (devMailboxEnabled()) {
      await ctx.runMutation(internal.authEmails.recordDevMail, { to: args.to, key: args.key, actionUrl: args.actionUrl });
    }
    await ctx.runAction(internal.email.sendTemplate, {
      key: args.key,
      to: args.to,
      idempotencyKey: args.idempotencyKey,
      dataVariables: { actionUrl: args.actionUrl, expiresInHours: args.expiresInHours },
    });
    return null;
  },
});

export const recordDevMail = internalMutation({
  args: { to: v.string(), key: v.string(), actionUrl: v.string() },
  handler: async (ctx, args) => {
    if (!devMailboxEnabled()) return null;
    await ctx.db.insert("devMailbox", { to: args.to.toLowerCase(), key: args.key, actionUrl: args.actionUrl, createdAt: Date.now() });
    const old = await ctx.db.query("devMailbox").withIndex("by_created").order("desc").collect();
    for (const row of old.slice(MAILBOX_LIMIT)) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Recent identity emails for one address — development and preview only. The caller must present the
 * deployment's FOLEVI_DEV_MAILBOX_SECRET (held server-side by the Next.js dev mailbox route), so the
 * links are not readable by arbitrary clients even outside production.
 */
export const devMailbox = query({
  args: { to: v.optional(v.string()), secret: v.string() },
  handler: async (ctx, args) => {
    const expected = process.env.FOLEVI_DEV_MAILBOX_SECRET;
    if (!devMailboxEnabled() || !expected || expected === "none" || !timingSafeEqualHex(args.secret, expected)) return null;
    const rows = args.to
      ? await ctx.db.query("devMailbox").withIndex("by_to", (q) => q.eq("to", args.to!.toLowerCase())).order("desc").take(20)
      : await ctx.db.query("devMailbox").withIndex("by_created").order("desc").take(50);
    return rows.map((r) => ({ to: r.to, key: r.key, actionUrl: r.actionUrl, createdAt: r.createdAt }));
  },
});

/** Whether new accounts may be created (admin feature flag `new_signups`). */
export const signupsOpen = internalQuery({
  args: {},
  handler: async (ctx) => await isFeatureEnabled(ctx, "new_signups"),
});
