import { v } from "convex/values";
import { mutation } from "./_generated/server";

/**
 * Marks a connected app's refresh token as used, once: what the OAuth provider does when it rotates or
 * revokes one ("set revoked where revoked is null"). Done in one mutation so two refreshes racing with the
 * same token can't both win. A token the provider stored never has `revoked` at all (it leaves unset fields
 * out), which the generic adapter's `eq null` doesn't match, so this treats missing and null alike
 * (see guardRefreshTokenRevoke in convex/lib/authAdapter.ts). Returns the row as it now is, or null when
 * it's gone or was already used.
 */
export const markRevoked = mutation({
  args: { id: v.string(), revoked: v.number() },
  handler: async (ctx, { id, revoked }) => {
    const docId = ctx.db.normalizeId("oauthRefreshToken", id);
    const doc = docId ? await ctx.db.get(docId) : null;
    if (!docId || !doc || doc.revoked != null) return null;
    await ctx.db.patch(docId, { revoked });
    return { ...doc, revoked };
  },
});
