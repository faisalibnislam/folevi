// Centralized authentication and authorization. Every public query/mutation/action goes through these
// helpers; client-supplied user ids, roles or workspace ownership are never trusted.
import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

type Ctx = QueryCtx | MutationCtx;
export type WorkspaceRole = Doc<"workspaceMembers">["role"];
export type Access = "none" | "read" | "comment" | "write" | "manage";
export type PlatformRole = NonNullable<Doc<"profiles">["platformRole"]>;

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, commenter: 1, editor: 2, admin: 3, owner: 4 };
const ACCESS_RANK: Record<Access, number> = { none: -1, read: 0, comment: 1, write: 2, manage: 3 };

export const CLAIM_EMAIL_VERIFIED = "https://folevi.com/email_verified";
export const CLAIM_MFA = "https://folevi.com/mfa";

export function roleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function accessAtLeast(access: Access, min: Access): boolean {
  return ACCESS_RANK[access] >= ACCESS_RANK[min];
}

function maxAccess(a: Access, b: Access): Access {
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

export function roleToAccess(role: WorkspaceRole | Doc<"documentPermissions">["role"]): Access {
  switch (role) {
    case "owner":
    case "admin":
      return "manage";
    case "editor":
      return "write";
    case "commenter":
      return "comment";
    case "viewer":
      return "read";
  }
}

export interface VerifiedClaims {
  emailVerified: boolean;
  mfa: boolean;
}

export function claimsOf(identity: UserIdentity): VerifiedClaims {
  const raw = identity as unknown as Record<string, unknown>;
  const emailVerified = identity.emailVerified === true || raw[CLAIM_EMAIL_VERIFIED] === true;
  const mfa = raw[CLAIM_MFA] === true;
  return { emailVerified, mfa };
}

export function enforcementFlags() {
  return {
    requireVerifiedEmail: process.env.FOLEVI_REQUIRE_VERIFIED_EMAIL !== "false",
    requireMfa: process.env.FOLEVI_REQUIRE_MFA !== "false",
  };
}

export async function requireIdentity(ctx: { auth: Ctx["auth"] }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("unauthenticated", "Sign in to continue.");
  return identity;
}

/** Enforces the verified-email and TOTP requirements carried as signed claims in the identity token. */
export function assertIdentityClaims(identity: UserIdentity): VerifiedClaims {
  const claims = claimsOf(identity);
  const flags = enforcementFlags();
  if (flags.requireVerifiedEmail && !claims.emailVerified) fail("email_unverified", "Verify your email address to continue.");
  if (flags.requireMfa && !claims.mfa) fail("mfa_required", "Two-step verification is required.");
  return claims;
}

export async function findProfile(ctx: Ctx, identity: UserIdentity): Promise<Doc<"profiles"> | null> {
  return await ctx.db
    .query("profiles")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireProfile(ctx: Ctx): Promise<Doc<"profiles">> {
  const identity = await requireIdentity(ctx);
  assertIdentityClaims(identity);
  const profile = await findProfile(ctx, identity);
  if (!profile) fail("profile_missing", "Finish setting up your account.");
  if (profile.status === "suspended") fail("suspended", "This account is suspended.");
  if (profile.status === "deleted") fail("account_deleted", "This account has been deleted.");
  return profile;
}

/** Like requireProfile, but returns null instead of throwing when signed out (for optional UI). */
export async function optionalProfile(ctx: Ctx): Promise<Doc<"profiles"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const profile = await findProfile(ctx, identity);
  if (!profile || profile.status === "suspended" || profile.status === "deleted") return null;
  return profile;
}

export async function assertWritable(ctx: Ctx, profile: Doc<"profiles">): Promise<void> {
  const setting = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (q) => q.eq("key", "maintenance"))
    .unique();
  const value = setting?.value as { readOnly?: boolean } | undefined;
  if (value?.readOnly && !profile.platformRole) fail("maintenance", "Folevi is in read-only maintenance. Your changes are kept on this device.");
  if (profile.status === "pending_deletion") fail("forbidden", "This account is scheduled for deletion.");
}

export async function membership(
  ctx: Ctx,
  profileId: Id<"profiles">,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"workspaceMembers"> | null> {
  return await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", workspaceId).eq("profileId", profileId))
    .unique();
}

export async function requireWorkspace(
  ctx: Ctx,
  profile: Doc<"profiles">,
  workspacePublicId: string,
  minRole: WorkspaceRole = "viewer",
): Promise<{ workspace: Doc<"workspaces">; member: Doc<"workspaceMembers"> }> {
  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_public_id", (q) => q.eq("publicId", workspacePublicId))
    .unique();
  if (!workspace) fail("not_found", "Workspace not found.");
  const member = await membership(ctx, profile._id, workspace._id);
  // Same error for "does not exist" and "not a member" to avoid leaking workspace existence.
  if (!member) fail("not_found", "Workspace not found.");
  if (workspace.status === "suspended" && !roleAtLeast(member.role, "owner")) fail("suspended", "This workspace is suspended.");
  if (!roleAtLeast(member.role, minRole)) fail("forbidden", "You don't have permission to do that.");
  return { workspace, member };
}

/**
 * Effective access of `profile` to `doc`:
 * - workspace-mode documents: the member's workspace role, raised by any explicit grant;
 * - restricted documents (or descendants of one): owners/admins and the creator manage, everyone else
 *   needs an explicit grant on the document or an ancestor.
 */
export async function documentAccess(ctx: Ctx, profile: Doc<"profiles">, doc: Doc<"documents">): Promise<Access> {
  const workspace = await ctx.db.get(doc.workspaceId);
  if (!workspace || workspace.status === "deleting") return "none";
  const member = await membership(ctx, profile._id, doc.workspaceId);

  // Walk ancestors (bounded) to find restriction and explicit grants.
  let restricted = false;
  let grant: Access = "none";
  let cursor: Doc<"documents"> | null = doc;
  for (let depth = 0; cursor && depth < 12; depth++) {
    if (cursor.accessMode === "restricted") restricted = true;
    const current: Doc<"documents"> = cursor;
    const permission = await ctx.db
      .query("documentPermissions")
      .withIndex("by_document_profile", (q) => q.eq("documentId", current._id).eq("profileId", profile._id))
      .unique();
    if (permission) grant = maxAccess(grant, roleToAccess(permission.role));
    cursor = current.parentDocumentId ? await ctx.db.get(current.parentDocumentId) : null;
  }

  if (workspace.status === "suspended" && !(member && member.role === "owner")) {
    return member || grant !== "none" ? "read" : "none";
  }
  if (member && roleAtLeast(member.role, "admin")) return "manage";
  if (restricted) {
    if (doc.createdBy === profile._id && member) return "manage";
    return grant;
  }
  const base: Access = member ? roleToAccess(member.role) : "none";
  return maxAccess(base, grant);
}

export async function getDocumentByPublicId(ctx: Ctx, publicId: string): Promise<Doc<"documents"> | null> {
  return await ctx.db
    .query("documents")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
}

export async function requireDocument(
  ctx: Ctx,
  profile: Doc<"profiles">,
  publicId: string,
  need: Access,
): Promise<{ doc: Doc<"documents">; access: Access }> {
  const doc = await getDocumentByPublicId(ctx, publicId);
  if (!doc) fail("not_found", "Document not found.");
  const access = await documentAccess(ctx, profile, doc);
  if (access === "none") fail("not_found", "Document not found.");
  if (!accessAtLeast(access, need)) fail("forbidden", "You don't have permission to do that.");
  return { doc, access };
}

export async function requirePlatformRole(ctx: Ctx, roles: PlatformRole[]): Promise<Doc<"profiles">> {
  const profile = await requireProfile(ctx);
  if (!profile.platformRole || !roles.includes(profile.platformRole)) {
    // Admin endpoints look like they don't exist to everyone else.
    fail("not_found", "Not found.");
  }
  return profile;
}

export const ALL_ADMIN_ROLES: PlatformRole[] = ["super_admin", "support_admin", "ops_admin"];
