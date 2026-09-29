// Centralized authentication and authorization. Every public query/mutation/action goes through these
// helpers; client-supplied user ids, roles or workspace ownership are never trusted.
import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";
import { CLAIM_EMAIL_VERIFIED, CLAIM_MFA } from "./claims";
import { findActiveSession } from "./authStore";
import { deviceStatus } from "./devices";
import { hasValidScope, personalScope, scopeOfRow, workspaceScope, type Scope, type ScopeArg, type ScopedRow } from "./scope";

type Ctx = QueryCtx | MutationCtx;
export type WorkspaceRole = Doc<"workspaceMembers">["role"];
export type Access = "none" | "read" | "comment" | "write" | "manage";
export type PlatformRole = NonNullable<Doc<"profiles">["platformRole"]>;

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, commenter: 1, editor: 2, admin: 3, owner: 4 };
const ACCESS_RANK: Record<Access, number> = { none: -1, read: 0, comment: 1, write: 2, manage: 3 };

export { CLAIM_EMAIL_VERIFIED, CLAIM_MFA };

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
  };
}

export async function requireIdentity(ctx: { auth: Ctx["auth"] }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("unauthenticated", "Sign in to continue.");
  return identity;
}

/**
 * Enforces the verified-email requirement carried as a signed claim in the identity token. Two-step
 * verification is optional for everyone except platform admins (see requirePlatformRole).
 */
export function assertIdentityClaims(identity: UserIdentity): VerifiedClaims {
  const claims = claimsOf(identity);
  const flags = enforcementFlags();
  if (flags.requireVerifiedEmail && !claims.emailVerified) fail("email_unverified", "Verify your email address to continue.");
  return claims;
}

/** The Better Auth session id carried by the token (added by the Convex plugin). */
export function sessionIdOf(identity: UserIdentity): string | null {
  const raw = identity as unknown as Record<string, unknown>;
  return typeof raw.sessionId === "string" ? raw.sessionId : null;
}

/**
 * The session behind the token must still exist: signing out, revoking a session (Settings or admin),
 * resetting the password and account suspension all delete sessions, and that takes effect on the very
 * next backend call even though the short-lived token itself hasn't expired yet. Because live queries
 * read the session row, open subscriptions re-run (and fail) as soon as it's deleted.
 */
export async function requireActiveSession(ctx: Ctx, identity: UserIdentity): Promise<string> {
  const sessionId = sessionIdOf(identity);
  if (!sessionId || !(await findActiveSession(ctx, sessionId))) fail("unauthenticated", "This session has ended. Sign in again.");
  return sessionId;
}

export async function findProfile(ctx: Ctx, identity: UserIdentity): Promise<Doc<"profiles"> | null> {
  return await ctx.db
    .query("profiles")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

/**
 * The signed-in person. Also enforces their plan's device limit: a device held at the limit (see
 * lib/devices.ts) is refused — except by the few functions that let it get unstuck (listing and signing out
 * devices, upgrading), which pass `allowOverDeviceLimit`.
 */
export async function requireProfile(ctx: Ctx, opts: { allowOverDeviceLimit?: boolean } = {}): Promise<Doc<"profiles">> {
  const identity = await requireIdentity(ctx);
  assertIdentityClaims(identity);
  const sessionId = await requireActiveSession(ctx, identity);
  const profile = await findProfile(ctx, identity);
  if (!profile) fail("profile_missing", "Finish setting up your account.");
  if (profile.status === "suspended") fail("suspended", "This account is suspended.");
  if (profile.status === "deleted") fail("account_deleted", "This account has been deleted.");
  if (!opts.allowOverDeviceLimit && !(await deviceStatus(ctx, profile, sessionId)).allowed) {
    fail("device_limit", "Your plan's device limit is reached. Sign out on another device or upgrade to use Folevi here.");
  }
  return profile;
}

/** Like requireProfile, but returns null instead of throwing when signed out (for optional UI). */
export async function optionalProfile(ctx: Ctx): Promise<Doc<"profiles"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const sessionId = sessionIdOf(identity);
  if (!sessionId || !(await findActiveSession(ctx, sessionId))) return null;
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

/**
 * A team workspace the caller is a member of (at least `minRole`). Workspaces left over from the old model's
 * Personal (kind "personal") are never a workspace scope: they read as not found.
 */
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
  if (!workspace || workspace.kind !== "team" || workspace.status === "deleting") fail("not_found", "Workspace not found.");
  const member = await membership(ctx, profile._id, workspace._id);
  // Same error for "does not exist" and "not a member" to avoid leaking workspace existence.
  if (!member) fail("not_found", "Workspace not found.");
  if (workspace.status === "suspended" && !roleAtLeast(member.role, "owner")) fail("suspended", "This workspace is suspended.");
  if (!roleAtLeast(member.role, minRole)) fail("forbidden", "You don't have permission to do that.");
  return { workspace, member };
}

/** A scope the caller may act in, and their role there (they own their Personal). */
export interface ScopeAccess {
  scope: Scope;
  /** The team workspace; null in Personal. */
  workspace: Doc<"workspaces"> | null;
  member: Doc<"workspaceMembers"> | null;
  role: WorkspaceRole;
}

/**
 * Resolves a client-named scope. Personal is always the caller's own (no profile id is accepted from the
 * client), where they are the owner; a workspace needs membership of at least `minRole`.
 */
export async function resolveScope(ctx: Ctx, profile: Doc<"profiles">, arg: ScopeArg, minRole: WorkspaceRole = "viewer"): Promise<ScopeAccess> {
  if (arg.kind === "personal") return { scope: personalScope(profile._id), workspace: null, member: null, role: "owner" };
  const { workspace, member } = await requireWorkspace(ctx, profile, arg.workspaceId, minRole);
  return { scope: workspaceScope(workspace._id), workspace, member, role: member.role };
}

/**
 * The scope of an existing row (a folder, a tag, a collection…) when the caller may act in it: their own
 * Personal, or a workspace they're a member of (at least `minRole`). Anything else reads as not found.
 */
export async function requireRowScope(ctx: Ctx, profile: Doc<"profiles">, row: ScopedRow, minRole: WorkspaceRole = "viewer", notFound = "Not found."): Promise<ScopeAccess> {
  if (!hasValidScope(row)) fail("not_found", notFound);
  const scope = scopeOfRow(row);
  if (scope.kind === "personal") {
    if (scope.profileId !== profile._id) fail("not_found", notFound);
    return { scope, workspace: null, member: null, role: "owner" };
  }
  const workspace = await ctx.db.get(scope.workspaceId);
  if (!workspace) fail("not_found", notFound);
  return await resolveScope(ctx, profile, { kind: "workspace", workspaceId: workspace.publicId }, minRole);
}

/** The highest page grant `profile` holds on `doc` or any of its ancestors (grants are inherited). */
async function inheritedGrant(ctx: Ctx, profile: Doc<"profiles">, doc: Doc<"documents">): Promise<{ grant: Access; restricted: boolean }> {
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
  return { grant, restricted };
}

/**
 * Effective access of `profile` to `doc`:
 * - Personal: the owner manages everything in it; anyone else only through a page grant on the page or
 *   an ancestor (a guest). Personal has no members.
 * - workspace-mode documents: the member's workspace role, raised by any explicit grant;
 * - restricted documents (or descendants of one): owners/admins and the creator manage, everyone else
 *   needs an explicit grant on the document or an ancestor.
 */
export async function documentAccess(ctx: Ctx, profile: Doc<"profiles">, doc: Doc<"documents">): Promise<Access> {
  if (!hasValidScope(doc)) return "none";
  const scope = scopeOfRow(doc);
  if (scope.kind === "personal") {
    if (scope.profileId === profile._id) return "manage";
    const owner = await ctx.db.get(scope.profileId);
    if (!owner || owner.status === "deleted") return "none";
    const { grant } = await inheritedGrant(ctx, profile, doc);
    // A suspended account's Personal stays readable to the people it was shared with, nothing more.
    if (owner.status === "suspended") return grant !== "none" ? "read" : "none";
    return grant;
  }
  const workspace = await ctx.db.get(scope.workspaceId);
  if (!workspace || workspace.status === "deleting") return "none";
  const member = await membership(ctx, profile._id, workspace._id);
  const { grant, restricted } = await inheritedGrant(ctx, profile, doc);

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
  // Two-step verification is optional for accounts, but the admin console always requires it. Checked
  // after the role so nobody else learns that an admin area exists.
  const identity = await requireIdentity(ctx);
  if (!claimsOf(identity).mfa) fail("mfa_required", "Turn on two-step verification to use the admin console.");
  return profile;
}

export const ALL_ADMIN_ROLES: PlatformRole[] = ["super_admin", "support_admin", "ops_admin"];
