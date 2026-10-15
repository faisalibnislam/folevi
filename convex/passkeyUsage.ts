// "Last used" for passkeys (Settings > Security > Passkeys). Better Auth's passkey table has no such field,
// so a passkey sign-in that passed Folevi's checks (convex/auth.ts checkPasskeySignIn) records the time
// here, by the passkey's row id. Rows go when the passkey is removed (the delete endpoint's after hook, and
// any left over are pruned on the owner's next sign-in) and with the account (maintenance.ts purgeAccount).
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireProfile } from "./lib/auth";

async function passkeyExists(ctx: MutationCtx, passkeyId: string): Promise<boolean> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "passkey", where: [{ field: "_id", value: passkeyId }] })) !== null;
}

/** A passkey just signed its owner in. */
export const record = internalMutation({
  args: { passkeyId: v.string(), authSubject: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", args.authSubject))
      .first();
    if (!profile) return null;
    const now = Date.now();
    const rows = await ctx.db
      .query("passkeyUsage")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(100);
    let found = false;
    for (const row of rows) {
      if (row.passkeyId === args.passkeyId) {
        found = true;
        await ctx.db.patch(row._id, { lastUsedAt: now });
      } else if (!(await passkeyExists(ctx, row.passkeyId))) {
        // Removed some way the delete hook didn't see: nothing to show it for any more.
        await ctx.db.delete(row._id);
      }
    }
    if (!found) await ctx.db.insert("passkeyUsage", { passkeyId: args.passkeyId, profileId: profile._id, lastUsedAt: now });
    return null;
  },
});

/** A passkey was removed: its row goes too (only once it's really gone). */
export const forget = internalMutation({
  args: { passkeyId: v.string() },
  handler: async (ctx, args) => {
    if (await passkeyExists(ctx, args.passkeyId)) return null;
    const rows = await ctx.db
      .query("passkeyUsage")
      .withIndex("by_passkey", (q) => q.eq("passkeyId", args.passkeyId))
      .take(10);
    for (const row of rows) await ctx.db.delete(row._id);
    return null;
  },
});

/** When each of your passkeys last signed you in (passkeys never used to sign in aren't listed). */
export const lastUsed = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("passkeyUsage")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(100);
    return rows.map((r) => ({ passkeyId: r.passkeyId, lastUsedAt: r.lastUsedAt }));
  },
});
