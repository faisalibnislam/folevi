// Folevi Server invitations, as the invited person sees them (docs/self-hosting/CONTRACT.md §7): what an
// invitation link is for (`preview`, no sign-in needed) and joining with it (`accept`). Admins make and revoke
// invitations in convex/serverAdmin.ts. Server edition only.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfile } from "./lib/auth";
import { isServerEdition } from "./lib/edition";
import { fail } from "./lib/errors";
import { findInvite, inviteState, inviteUsableBy, requireServerEdition, roleAfterInvite } from "./lib/serverAccess";
import { readServerSettings, roleFields, serverRoleOf } from "./lib/serverSettings";

/** What an invitation is for, or null for a link that never was one. Shows the address only when the invite names one. */
export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!isServerEdition()) return null;
    const invite = await findInvite(ctx, args.token);
    if (!invite) return null;
    const settings = await readServerSettings(ctx);
    const inviter = await ctx.db.get(invite.invitedBy);
    const state = inviteState(invite);
    return {
      serverName: settings.name,
      invitedBy: inviter?.displayName ?? "The server's owner",
      ...(invite.email ? { email: invite.email } : {}),
      role: invite.role,
      expired: state !== "pending",
    };
  },
});

/**
 * Joins the server with an invitation: the signed-in person gets the invite's role (never lower than the one they
 * have; the owner stays the owner). An invite that names an address works only for that address. A sign-up that
 * used the link spent it for its own address; that account accepts it here.
 */
export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    requireServerEdition();
    const profile = await requireProfile(ctx);
    const invite = await findInvite(ctx, args.token);
    if (!invite || !inviteUsableBy(invite, profile.email)) fail("expired", "This invitation has expired, was already used, or is for someone else.");
    const role = roleAfterInvite(serverRoleOf(profile), invite.role);
    await ctx.db.patch(profile._id, roleFields(role));
    await ctx.db.patch(invite._id, { acceptedBy: profile._id, acceptedAt: Date.now(), usedByEmail: invite.usedByEmail ?? profile.email });
    console.log(JSON.stringify({ event: "server.invite_accepted", role, inviteId: invite._id }));
    return { ok: true, role };
  },
});
