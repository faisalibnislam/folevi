// Identity operations used by the admin console, account deletion and suspension, implemented on
// Folevi's own Better Auth store (convex/auth.ts). Every function reports what actually happened;
// when the admin console passes `actorId` + `requestId`, the outcome is appended to the audit log.
import { v } from "convex/values";
import { internalAction, internalMutation, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createAuth, siteUrl } from "./auth";
import { deleteAuthUser, deleteUserSessions, findAuthUser } from "./lib/authStore";

type Outcome = { ok: boolean; code: string };

const vAudit = { actorId: v.optional(v.id("profiles")), requestId: v.optional(v.string()) };

async function subjectOf(ctx: ActionCtx, profileId: Id<"profiles">): Promise<{ authSubject: string; email: string } | null> {
  const p = await ctx.runQuery(internal.users.getForEmail, { profileId });
  return p?.authSubject ? { authSubject: p.authSubject, email: p.email } : null;
}

export const recordOutcome = internalMutation({
  args: { actorId: v.id("profiles"), requestId: v.string(), action: v.string(), targetId: v.id("profiles"), outcome: v.string() },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorId);
    await ctx.db.insert("adminAuditLogs", {
      actorId: args.actorId,
      actorRole: actor?.platformRole ?? "super_admin",
      action: `${args.action}.result`,
      targetType: "profile",
      targetId: args.targetId,
      reason: `Outcome: ${args.outcome}`,
      requestId: args.requestId,
      createdAt: Date.now(),
    });
    return null;
  },
});

async function report(ctx: ActionCtx, args: { actorId?: Id<"profiles">; requestId?: string; profileId: Id<"profiles"> }, action: string, outcome: Outcome) {
  console.log(JSON.stringify({ event: "identity.action", action, ok: outcome.ok, code: outcome.code, requestId: args.requestId ?? null }));
  if (args.actorId && args.requestId) {
    await ctx.runMutation(internal.identity.recordOutcome, { actorId: args.actorId, requestId: args.requestId, action, targetId: args.profileId, outcome: outcome.code });
  }
  return outcome;
}

/** Ends every session of the person (all devices). Tokens stop working on their next backend call. */
export const revokeProviderSessions = internalAction({
  args: { profileId: v.id("profiles"), scope: v.union(v.literal("all"), v.literal("one")), ...vAudit },
  handler: async (ctx, args): Promise<Outcome> => {
    if (args.scope === "one") return { ok: true, code: "handled_by_caller" };
    const who = await subjectOf(ctx, args.profileId);
    if (!who) return await report(ctx, args, "identity.revoke_sessions", { ok: false, code: "no_identity" });
    const ended = await deleteUserSessions(ctx, who.authSubject);
    return await report(ctx, args, "identity.revoke_sessions", { ok: true, code: `ended_${ended}` });
  },
});

/** Sends a fresh verification link (only while the address is unverified). */
export const resendVerificationEmail = internalAction({
  args: { profileId: v.id("profiles"), ...vAudit },
  handler: async (ctx, args): Promise<Outcome> => {
    const who = await subjectOf(ctx, args.profileId);
    if (!who) return await report(ctx, args, "identity.resend_verification", { ok: false, code: "no_identity" });
    const user = await findAuthUser(ctx, who.authSubject);
    if (!user) return await report(ctx, args, "identity.resend_verification", { ok: false, code: "no_identity" });
    if (user.emailVerified) return await report(ctx, args, "identity.resend_verification", { ok: false, code: "already_verified" });
    try {
      await createAuth(ctx).api.sendVerificationEmail({ body: { email: user.email, callbackURL: `${siteUrl()}/documents` } });
      return await report(ctx, args, "identity.resend_verification", { ok: true, code: "sent" });
    } catch {
      return await report(ctx, args, "identity.resend_verification", { ok: false, code: "send_failed" });
    }
  },
});

/** Sends a password-reset link to the person's own address (a user-requested reset). */
export const startPasswordReset = internalAction({
  args: { profileId: v.id("profiles"), ...vAudit },
  handler: async (ctx, args): Promise<Outcome> => {
    const who = await subjectOf(ctx, args.profileId);
    if (!who) return await report(ctx, args, "identity.password_reset", { ok: false, code: "no_identity" });
    try {
      await createAuth(ctx).api.requestPasswordReset({ body: { email: who.email, redirectTo: `${siteUrl()}/reset-password` } });
      return await report(ctx, args, "identity.password_reset", { ok: true, code: "sent" });
    } catch {
      return await report(ctx, args, "identity.password_reset", { ok: false, code: "send_failed" });
    }
  },
});

/**
 * Suspension: Folevi's backend already refuses suspended profiles on every call; blocking also ends all
 * live sessions so open tabs and devices are signed out immediately.
 */
export const setProviderBlocked = internalAction({
  args: { profileId: v.id("profiles"), blocked: v.boolean(), ...vAudit },
  handler: async (ctx, args): Promise<Outcome> => {
    if (!args.blocked) return await report(ctx, args, "identity.unblock", { ok: true, code: "profile_status_only" });
    const who = await subjectOf(ctx, args.profileId);
    if (!who) return await report(ctx, args, "identity.block", { ok: false, code: "no_identity" });
    const ended = await deleteUserSessions(ctx, who.authSubject);
    return await report(ctx, args, "identity.block", { ok: true, code: `sessions_ended_${ended}` });
  },
});

/** Final step of account deletion: removes credentials, sessions and two-step data. */
export const deleteProviderUser = internalAction({
  args: { authSubject: v.string() },
  handler: async (ctx, args): Promise<Outcome> => {
    const user = await findAuthUser(ctx, args.authSubject);
    if (!user) return { ok: true, code: "already_gone" };
    await deleteAuthUser(ctx, args.authSubject);
    console.log(JSON.stringify({ event: "identity.deleted", ok: true }));
    return { ok: true, code: "deleted" };
  },
});
