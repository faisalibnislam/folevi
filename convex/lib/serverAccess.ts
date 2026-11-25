// Folevi Server: who may use the server admin functions, whether the server has an owner yet, and the
// invitations people join with (docs/self-hosting/CONTRACT.md §7). Server edition only: every entry point
// answers `not_found` on Folevi Cloud, so the server API looks like it doesn't exist there.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireProfile } from "./auth";
import { sha256Hex } from "./crypto";
import { isServerEdition } from "./edition";
import { fail } from "./errors";
import { readServerSettings, roleFields, serverRoleOf, type ServerRole, type ServerSettings } from "./serverSettings";

type Ctx = QueryCtx | MutationCtx;

/** How long an invitation link works. */
export const INVITE_DAYS = 7;
export const INVITE_TTL_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;

/** Refuses outside the server edition, as if the function didn't exist. */
export function requireServerEdition(): void {
  if (!isServerEdition()) fail("not_found", "Not found.");
}

/**
 * The signed-in owner or admin (or, with `roles`, only those roles). Everyone else gets `not_found`, as the
 * cloud admin console does (convex/admin.ts). Unlike the cloud console, two-step verification isn't required:
 * a home server's owner may not have an authenticator app, and the owner turns that rule on for people.
 */
export async function requireServerAdmin(ctx: Ctx, roles: ServerRole[] = ["owner", "admin"]): Promise<{ profile: Doc<"profiles">; role: ServerRole }> {
  requireServerEdition();
  const profile = await requireProfile(ctx);
  const role = serverRoleOf(profile);
  if (!roles.includes(role)) fail("not_found", "Not found.");
  return { profile, role };
}

/** The owner's profile, if the server has one (the settings' ownerUserId, else any super_admin). */
export async function serverOwner(ctx: Ctx, settings?: ServerSettings): Promise<Doc<"profiles"> | null> {
  const s = settings ?? (await readServerSettings(ctx));
  if (s.ownerUserId) {
    const owner = await ctx.db.get(s.ownerUserId);
    if (owner && owner.status !== "deleted" && owner.platformRole === "super_admin") return owner;
  }
  const supers = await ctx.db
    .query("profiles")
    .withIndex("by_platform_role", (q) => q.eq("platformRole", "super_admin"))
    .take(5);
  return supers.find((p) => p.status !== "deleted") ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------------------------------

export const inviteTokenHash = (token: string) => sha256Hex(`folevi-server-invite:${token.trim()}`);

export async function findInvite(ctx: Ctx, token: string): Promise<Doc<"serverInvites"> | null> {
  const t = token.trim();
  if (!t || t.length > 200) return null;
  const hash = await inviteTokenHash(t);
  return await ctx.db
    .query("serverInvites")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
    .first();
}

export type InviteState = "pending" | "used" | "accepted" | "revoked" | "expired";

export function inviteState(invite: Doc<"serverInvites">, now = Date.now()): InviteState {
  if (invite.revokedAt) return "revoked";
  if (invite.acceptedBy) return "accepted";
  if (invite.usedByEmail) return "used";
  if (invite.expiresAt <= now) return "expired";
  return "pending";
}

/**
 * Whether `email` may join with this invite: a pending invite (for that address, when it names one), or one a
 * sign-up with that very address already spent (the new account accepts it).
 */
export function inviteUsableBy(invite: Doc<"serverInvites">, email: string, now = Date.now()): boolean {
  const addr = email.trim().toLowerCase();
  const state = inviteState(invite, now);
  if (invite.email && invite.email !== addr) return false;
  if (state === "pending") return true;
  return state === "used" && invite.usedByEmail === addr;
}

/** A role a person may be given by an invite: never above admin, and an owner keeps being the owner. */
export function roleAfterInvite(current: ServerRole, invited: ServerRole): ServerRole {
  if (current === "owner") return "owner";
  // An invite never lowers someone: an admin who follows a member's link stays an admin.
  const rank: Record<ServerRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };
  return rank[invited] > rank[current] ? invited : current;
}


/**
 * Folevi Server: when a new account was created with an invitation (Better Auth's user hook spent it for this
 * address), the account gets the invite's role as its profile is made (users.bootstrap). The newest such invite
 * counts; nothing happens without one.
 */
export async function acceptSpentInvite(ctx: MutationCtx, profileId: Doc<"profiles">["_id"], email: string): Promise<void> {
  const addr = email.trim().toLowerCase();
  const recent = await ctx.db.query("serverInvites").withIndex("by_created").order("desc").take(500);
  const invite = recent.find((i) => !i.revokedAt && !i.acceptedBy && i.usedByEmail === addr);
  if (!invite) return;
  const profile = await ctx.db.get(profileId);
  if (!profile) return;
  const role = roleAfterInvite(serverRoleOf(profile), invite.role);
  await ctx.db.patch(profileId, roleFields(role));
  await ctx.db.patch(invite._id, { acceptedBy: profileId, acceptedAt: Date.now() });
}
