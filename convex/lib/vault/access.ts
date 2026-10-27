// Who someone is in a Vault (docs/VAULT_PLAN.md §1), decided in one place, as lib/auth.ts does for notes.
//
//   Personal Vault   its owner, and nobody else
//   Team Vault       the workspace owner (always a custodian), custodians and members the owner or a custodian
//                    added (vaultMembers). Workspace admins and members have no access unless added; guests never.
//
// Access ends with workspace membership: someone removed from the workspace is out of its Vault at once, even
// before their vaultMembers row is cleaned up. A suspended or closing workspace keeps only its owner.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { fail } from "../errors";
import { isScheduledForDeletion, membership, normalizeMembership } from "../auth";
import { scopeFields, scopeOfRow, type Scope } from "../scope";

type Ctx = QueryCtx | MutationCtx;

export type VaultRole = "owner" | "custodian" | "member";

const RANK: Record<VaultRole, number> = { member: 0, custodian: 1, owner: 2 };

/** Whether `role` is at least `min` (the owner is a custodian too). */
export function vaultRoleAtLeast(role: VaultRole | null, min: VaultRole): boolean {
  return role !== null && RANK[role] >= RANK[min];
}

/** Locks after this many idle minutes unless the team Vault's custodians chose otherwise (1 to 30). */
export const DEFAULT_AUTO_LOCK_MINUTES = 5;
export const AUTO_LOCK_RANGE = [1, 30] as const;

/** The Vault of a scope, if it has been made. */
export async function vaultOfScope(ctx: Ctx, scope: Scope): Promise<Doc<"vaults"> | null> {
  return scope.kind === "personal"
    ? await ctx.db
        .query("vaults")
        .withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
        .first()
    : await ctx.db
        .query("vaults")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
        .first();
}

export async function vaultByPublicId(ctx: Ctx, publicId: string): Promise<Doc<"vaults"> | null> {
  return await ctx.db
    .query("vaults")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
}

export async function vaultMemberRow(ctx: Ctx, vaultId: Id<"vaults">, profileId: Id<"profiles">): Promise<Doc<"vaultMembers"> | null> {
  return await ctx.db
    .query("vaultMembers")
    .withIndex("by_vault_profile", (q) => q.eq("vaultId", vaultId).eq("profileId", profileId))
    .unique();
}

/**
 * Whether `profileId` would be the owner of `scope`'s Vault: the Personal's owner, or the workspace's owner
 * (still a member, the workspace not being deleted).
 */
export async function isScopeOwner(ctx: Ctx, profileId: Id<"profiles">, scope: Scope): Promise<boolean> {
  if (scope.kind === "personal") return scope.profileId === profileId;
  const workspace = await ctx.db.get(scope.workspaceId);
  if (!workspace || workspace.status === "deleting") return false;
  const m = await membership(ctx, profileId, workspace._id);
  return Boolean(m && normalizeMembership(m).role === "owner");
}

/** Someone's role in a Vault, or null for no access. */
export async function vaultRoleOf(ctx: Ctx, profile: Doc<"profiles">, vault: Doc<"vaults">): Promise<VaultRole | null> {
  if (profile.status !== "active") return null;
  const scope = scopeOfRow(vault);
  if (scope.kind === "personal") return scope.profileId === profile._id ? "owner" : null;
  const workspace = await ctx.db.get(scope.workspaceId);
  if (!workspace || workspace.status === "deleting") return null;
  const m = await membership(ctx, profile._id, workspace._id);
  if (!m) return null;
  const owner = normalizeMembership(m).role === "owner";
  if (owner) return "owner";
  // A workspace that's suspended or closing keeps its Vault for its owner only.
  if (workspace.status === "suspended" || isScheduledForDeletion(workspace)) return null;
  const row = await vaultMemberRow(ctx, vault._id, profile._id);
  return row ? row.role : null;
}

/**
 * A Vault the caller may act in with at least `min`. No access reads as not found (nobody learns which
 * Vaults exist); access but too low a role is forbidden.
 */
export async function requireVault(ctx: Ctx, profile: Doc<"profiles">, vaultPublicId: string, min: VaultRole = "member"): Promise<{ vault: Doc<"vaults">; role: VaultRole }> {
  const vault = await vaultByPublicId(ctx, vaultPublicId);
  if (!vault) fail("not_found", "Vault not found.");
  const role = await vaultRoleOf(ctx, profile, vault);
  if (!role) fail("not_found", "Vault not found.");
  if (!vaultRoleAtLeast(role, min)) fail("forbidden", min === "owner" ? "Only the owner can do that." : "Only the Vault's custodians can do that.");
  return { vault, role };
}

/** The fields a new vault row needs besides its scope. */
export function newVaultFields(scope: Scope, publicId: string, createdBy: Id<"profiles">, genesis: string, now: number) {
  return {
    publicId,
    ...scopeFields(scope),
    keyVersion: 0,
    autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
    custodiansNameCustodians: false,
    logSeq: 0,
    logHead: genesis,
    createdBy,
    createdAt: now,
  };
}
