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
/** A membership role as stored (may still be an old member role until migrations.normalizeWorkspaceRoles has run). */
export type WorkspaceRole = Doc<"workspaceMembers">["role"];
/** Membership roles: every one of them takes a seat (lib/seats.ts). Guests have no membership. */
export type MemberRole = "owner" | "admin" | "member";
/** What a member may do with the workspace's content: full (edit), comment only, or view only. */
export type MemberAccess = "edit" | "comment" | "view";
/**
 * A membership's standing in one word, for "at least" checks: a member's access, then admin, then owner.
 * `requireWorkspace(…, "edit")` means "a member who can edit, an admin or the owner".
 */
export type WorkspaceLevel = MemberAccess | "admin" | "owner";
export type ShareRole = Doc<"documentPermissions">["role"];
export type Access = "none" | "read" | "comment" | "write" | "manage";
export type PlatformRole = NonNullable<Doc<"profiles">["platformRole"]>;

const LEVEL_RANK: Record<WorkspaceLevel, number> = { view: 0, comment: 1, edit: 2, admin: 3, owner: 4 };
const ACCESS_RANK: Record<Access, number> = { none: -1, read: 0, comment: 1, write: 2, manage: 3 };

export { CLAIM_EMAIL_VERIFIED, CLAIM_MFA };

/** The old member roles, read as Members with the matching access (until the migration rewrites them). */
const LEGACY_MEMBER_ACCESS: Partial<Record<WorkspaceRole, MemberAccess>> = { editor: "edit", commenter: "comment", viewer: "view" };

export function isLegacyRole(role: WorkspaceRole): boolean {
  return LEGACY_MEMBER_ACCESS[role] !== undefined;
}

/**
 * A membership as the product sees it: owner | admin | member, and for members their access. Old rows
 * (editor / commenter / viewer) read as member with edit / comment / view, so the code is correct before
 * and after `migrations.normalizeWorkspaceRoles` runs.
 */
export function normalizeMembership(m: { role: WorkspaceRole; memberAccess?: MemberAccess }): { role: MemberRole; memberAccess: MemberAccess } {
  const legacy = LEGACY_MEMBER_ACCESS[m.role];
  if (legacy) return { role: "member", memberAccess: legacy };
  if (m.role === "owner" || m.role === "admin") return { role: m.role, memberAccess: "edit" };
  return { role: "member", memberAccess: m.memberAccess ?? "edit" };
}

/** The role and access an invitation or role change asks for (old role names map to Member + access). */
export function requestedRole(role: "admin" | "member" | "editor" | "commenter" | "viewer", memberAccess?: MemberAccess): { role: "admin" | "member"; memberAccess?: MemberAccess } {
  if (role === "admin") return { role: "admin" };
  return { role: "member", memberAccess: LEGACY_MEMBER_ACCESS[role] ?? memberAccess ?? "edit" };
}

export function memberLevel(m: { role: WorkspaceRole; memberAccess?: MemberAccess }): WorkspaceLevel {
  const n = normalizeMembership(m);
  return n.role === "member" ? n.memberAccess : n.role;
}

export function levelAtLeast(level: WorkspaceLevel, min: WorkspaceLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

/** Whether a membership is at least `min` (e.g. "edit": a member who can edit, an admin or the owner). */
export function memberAtLeast(m: { role: WorkspaceRole; memberAccess?: MemberAccess } | null | undefined, min: WorkspaceLevel): boolean {
  return Boolean(m && levelAtLeast(memberLevel(m), min));
}

export function accessAtLeast(access: Access, min: Access): boolean {
  return ACCESS_RANK[access] >= ACCESS_RANK[min];
}

function maxAccess(a: Access, b: Access): Access {
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

/** Access a page grant gives. */
export function roleToAccess(role: ShareRole): Access {
  switch (role) {
    case "editor":
      return "write";
    case "commenter":
      return "comment";
    case "viewer":
      return "read";
  }
}

/** Access a membership gives to the workspace's (non-restricted) content: owners and admins manage it. */
export function memberToAccess(m: { role: WorkspaceRole; memberAccess?: MemberAccess }): Access {
  const level = memberLevel(m);
  return level === "owner" || level === "admin" ? "manage" : level === "edit" ? "write" : level === "comment" ? "comment" : "read";
}

/** The highest page-grant role someone with `access` may give (never more than their own access). */
export function maxShareRoleFor(access: Access): ShareRole | null {
  return access === "manage" || access === "write" ? "editor" : access === "comment" ? "commenter" : access === "read" ? "viewer" : null;
}

export function shareRoleAtMost(role: ShareRole, max: ShareRole): boolean {
  return ACCESS_RANK[roleToAccess(role)] <= ACCESS_RANK[roleToAccess(max)];
}

/** Whether the owner asked to delete this workspace (it's read-only for them and hidden from others until purged). */
export function isScheduledForDeletion(workspace: Doc<"workspaces">): boolean {
  return workspace.deletionScheduledFor !== undefined;
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
export const DELETION_SCHEDULED_MESSAGE = "This workspace is scheduled for deletion. Cancel the deletion to make changes.";

/**
 * A team workspace the caller is a member of (at least `minLevel`). Workspaces left over from the old
 * model's Personal (kind "personal") are never a workspace scope: they read as not found. A workspace
 * scheduled for deletion is hidden from everyone but its owner, who may only read it (and cancel the
 * deletion, which passes `allowScheduledDeletion`).
 */
export async function requireWorkspace(
  ctx: Ctx,
  profile: Doc<"profiles">,
  workspacePublicId: string,
  minLevel: WorkspaceLevel = "view",
  opts: { allowScheduledDeletion?: boolean } = {},
): Promise<{ workspace: Doc<"workspaces">; member: Doc<"workspaceMembers"> }> {
  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_public_id", (q) => q.eq("publicId", workspacePublicId))
    .unique();
  if (!workspace || workspace.kind !== "team" || workspace.status === "deleting") fail("not_found", "Workspace not found.");
  const member = await membership(ctx, profile._id, workspace._id);
  // Same error for "does not exist" and "not a member" to avoid leaking workspace existence.
  if (!member) fail("not_found", "Workspace not found.");
  const level = memberLevel(member);
  if (isScheduledForDeletion(workspace)) {
    if (level !== "owner") fail("not_found", "Workspace not found.");
    if (minLevel !== "view" && !opts.allowScheduledDeletion) fail("forbidden", DELETION_SCHEDULED_MESSAGE);
  }
  if (workspace.status === "suspended" && level !== "owner") fail("suspended", "This workspace is suspended.");
  if (!levelAtLeast(level, minLevel)) fail("forbidden", "You don't have permission to do that.");
  return { workspace, member };
}

/** A scope the caller may act in, and their standing there (they own their Personal). */
export interface ScopeAccess {
  scope: Scope;
  /** The team workspace; null in Personal. */
  workspace: Doc<"workspaces"> | null;
  member: Doc<"workspaceMembers"> | null;
  /** owner | admin | member ("owner" in your own Personal). */
  role: MemberRole;
  /** For "at least" checks (see WorkspaceLevel). */
  level: WorkspaceLevel;
}

/**
 * Resolves a client-named scope. Personal is always the caller's own (no profile id is accepted from the
 * client), where they are the owner; a workspace needs membership of at least `minLevel`.
 */
export async function resolveScope(ctx: Ctx, profile: Doc<"profiles">, arg: ScopeArg, minLevel: WorkspaceLevel = "view"): Promise<ScopeAccess> {
  if (arg.kind === "personal") return { scope: personalScope(profile._id), workspace: null, member: null, role: "owner", level: "owner" };
  const { workspace, member } = await requireWorkspace(ctx, profile, arg.workspaceId, minLevel);
  return { scope: workspaceScope(workspace._id), workspace, member, role: normalizeMembership(member).role, level: memberLevel(member) };
}

/**
 * The scope of an existing row (a folder, a tag, a collection…) when the caller may act in it: their own
 * Personal, or a workspace they're a member of (at least `minLevel`). Anything else reads as not found.
 */
export async function requireRowScope(ctx: Ctx, profile: Doc<"profiles">, row: ScopedRow, minLevel: WorkspaceLevel = "view", notFound = "Not found."): Promise<ScopeAccess> {
  if (!hasValidScope(row)) fail("not_found", notFound);
  const scope = scopeOfRow(row);
  if (scope.kind === "personal") {
    if (scope.profileId !== profile._id) fail("not_found", notFound);
    return { scope, workspace: null, member: null, role: "owner", level: "owner" };
  }
  const workspace = await ctx.db.get(scope.workspaceId);
  if (!workspace) fail("not_found", notFound);
  return await resolveScope(ctx, profile, { kind: "workspace", workspaceId: workspace.publicId }, minLevel);
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
  return (await documentAccessInfo(ctx, profile, doc)).access;
}

/** documentAccess, with how the caller stands in the page's scope (what sharing decisions need). */
export interface DocumentAccessInfo {
  access: Access;
  /** In the page's scope: its Personal's owner, or a member of its workspace. False for a guest. */
  inScope: boolean;
  /** Their membership of the page's workspace (null in Personal, or for a guest). */
  member: Doc<"workspaceMembers"> | null;
  /** The page or an ancestor is restricted to invited people. */
  restricted: boolean;
}

export async function documentAccessInfo(ctx: Ctx, profile: Doc<"profiles">, doc: Doc<"documents">): Promise<DocumentAccessInfo> {
  const none: DocumentAccessInfo = { access: "none", inScope: false, member: null, restricted: false };
  if (!hasValidScope(doc)) return none;
  const scope = scopeOfRow(doc);
  if (scope.kind === "personal") {
    if (scope.profileId === profile._id) return { access: "manage", inScope: true, member: null, restricted: false };
    const owner = await ctx.db.get(scope.profileId);
    if (!owner || owner.status === "deleted") return none;
    const { grant } = await inheritedGrant(ctx, profile, doc);
    // A suspended account's Personal stays readable to the people it was shared with, nothing more.
    if (owner.status === "suspended") return { ...none, access: grant !== "none" ? "read" : "none" };
    return { ...none, access: grant };
  }
  const workspace = await ctx.db.get(scope.workspaceId);
  if (!workspace || workspace.status === "deleting") return none;
  const member = await membership(ctx, profile._id, workspace._id);
  const level = member ? memberLevel(member) : null;
  // Scheduled for deletion: its owner can still read it (to export or cancel); everyone else, guests
  // included, has lost it.
  if (isScheduledForDeletion(workspace)) return level === "owner" ? { access: "read", inScope: true, member, restricted: false } : none;
  const { grant, restricted } = await inheritedGrant(ctx, profile, doc);
  const info = { inScope: member !== null, member, restricted };

  if (workspace.status === "suspended" && level !== "owner") {
    return { ...info, access: member || grant !== "none" ? "read" : "none" };
  }
  if (level === "owner" || level === "admin") return { ...info, access: "manage" };
  if (restricted) {
    if (doc.createdBy === profile._id && member) return { ...info, access: "manage" };
    return { ...info, access: grant };
  }
  const base: Access = member ? memberToAccess(member) : "none";
  return { ...info, access: maxAccess(base, grant) };
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
