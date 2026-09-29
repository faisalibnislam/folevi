// Workspace capabilities that aren't about content access (that's lib/auth.ts documentAccess). One place
// decides them; every function that needs one checks it on the server, and the web app only mirrors them
// to hide controls.
//
//                                  Owner  Admin               Member (edit)       Member (comment/view)  Guest
//   Workspace settings (general)   yes    yes                 read only           read only              -
//   Members: see the list          yes    yes                 yes                 yes                    -
//   Members: invite / change /     yes    members only        -                   -                      -
//     remove / convert to guest           (not admins)
//   Admins: invite / promote /     yes    -                   -                   -                      -
//     demote / remove
//   Guests list and guest access   yes    yes                 -                   -                      -
//   Share a page with guests       yes    yes                 pages they can edit -                      -
//                                                             (workspace mode)
//   Page access mode, public links yes    yes (+ the page's creator on restricted pages)                   -
//   Plan & billing                 yes    if the owner allows -                   -                      -
//   Export the whole workspace     yes    yes                 -                   -                      -
//   Transfer ownership / delete    yes    -                   -                   -                      -
//
// Guests (page grants without a membership) never get anything workspace-wide.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DELETION_SCHEDULED_MESSAGE, isScheduledForDeletion, membership, memberLevel, normalizeMembership, requireWorkspace, type Access, type DocumentAccessInfo, type MemberAccess, type WorkspaceRole } from "./auth";
import { fail } from "./errors";

type Ctx = QueryCtx | MutationCtx;
type Membership = Pick<Doc<"workspaceMembers">, "role"> & { memberAccess?: MemberAccess; canManageBilling?: boolean };

/** Owner or admin: workspace settings, members (within the admin rules), guests, sharing and export. */
export function canManageWorkspace(member: Membership | null | undefined): boolean {
  if (!member) return false;
  const role = normalizeMembership(member).role;
  return role === "owner" || role === "admin";
}

/** Who may invite, change and remove members (owners and admins; admins only for members). */
export const canManageWorkspaceMembers = canManageWorkspace;

/**
 * Whether `actor` may change or remove the membership `target` (role, access, removal, conversion to guest).
 * Nobody changes the owner here (ownership moves by transfer); only the owner changes admins.
 */
export function canManageMember(actor: Membership | null | undefined, target: Pick<Doc<"workspaceMembers">, "role">): boolean {
  if (!canManageWorkspaceMembers(actor)) return false;
  const targetRole = normalizeMembership(target).role;
  if (targetRole === "owner") return false;
  if (targetRole === "admin") return normalizeMembership(actor!).role === "owner";
  return true;
}

/** Whether `actor` may invite someone as `role` (admins only by the owner). */
export function canInviteMember(actor: Membership | null | undefined, role: "admin" | "member"): boolean {
  if (!canManageWorkspaceMembers(actor)) return false;
  return role === "member" || normalizeMembership(actor!).role === "owner";
}

/**
 * Whether a member may give people outside the workspace (guests) access to pages: owners and admins, and
 * members who can edit (each page is checked again by canShareDocument).
 */
export function canInviteGuest(member: Membership | null | undefined): boolean {
  if (!member) return false;
  const level = memberLevel(member);
  return level === "owner" || level === "admin" || level === "edit";
}

/** Who manages the workspace's guests (the Guests list: their access, removal, conversion to member). */
export const canManageWorkspaceGuests = canManageWorkspace;

/** Exporting a whole workspace (members can't: it would hand them pages restricted from them). */
export const canExportWorkspace = canManageWorkspace;

/**
 * What the caller may do in a page's Share dialog:
 * - `manage`: everything — access mode, public links, anyone's grants. Page managers: in Personal its owner;
 *   in a workspace owners, admins and (on restricted pages) the page's creator.
 * - `share`: add people (grants up to their own access, i.e. at most "Can edit") and change or remove the
 *   grants and invitations they made. Page managers, and workspace members who can edit the page when it
 *   isn't restricted (a restricted page is shared only by its managers).
 * Guests never share.
 */
export function sharePermissions(info: DocumentAccessInfo): { manage: boolean; share: boolean } {
  const manage = info.access === "manage";
  if (manage) return { manage, share: true };
  const share = info.inScope && info.member !== null && canInviteGuest(info.member) && !info.restricted && info.access === "write";
  return { manage: false, share };
}

/** Whether the caller may share this page with people (see sharePermissions). */
export function canShareDocument(info: DocumentAccessInfo): boolean {
  return sharePermissions(info).share;
}

/**
 * Who may see and change a workspace's plan and billing: its owner, and admins the owner allowed
 * ("Can manage billing" in Members). Members and guests never.
 */
export function memberCanManageBilling(member: Membership | null): boolean {
  if (!member) return false;
  const role = normalizeMembership(member).role;
  return role === "owner" || (role === "admin" && member.canManageBilling === true);
}

/** Whether `profile` may manage `workspace`'s billing (see memberCanManageBilling). */
export async function canManageWorkspaceBilling(ctx: Ctx, profile: Doc<"profiles">, workspace: Doc<"workspaces">): Promise<boolean> {
  if (workspace.kind !== "team" || workspace.status === "deleting" || isScheduledForDeletion(workspace)) return false;
  return memberCanManageBilling(await membership(ctx, profile._id, workspace._id));
}

export const BILLING_FORBIDDEN = "Only the workspace owner, or an admin they allow, can manage its plan and billing.";

/**
 * The workspace (by public id) when the caller may manage its billing; refuses everyone else. `write`
 * (buying, changing or resuming a plan, the billing portal) also refuses a workspace scheduled for
 * deletion: its plan is set to end, and only canceling the deletion brings billing back.
 */
export async function requireWorkspaceBilling(ctx: Ctx, profile: Doc<"profiles">, workspacePublicId: string, opts: { write?: boolean } = {}): Promise<{ workspace: Doc<"workspaces">; member: Doc<"workspaceMembers"> }> {
  const found = await requireWorkspace(ctx, profile, workspacePublicId);
  if (!memberCanManageBilling(found.member)) fail("forbidden", BILLING_FORBIDDEN);
  if (opts.write && isScheduledForDeletion(found.workspace)) fail("forbidden", DELETION_SCHEDULED_MESSAGE);
  return found;
}

export const MANAGER_ONLY = "Only the workspace's owner and admins can do that.";

/**
 * The workspace when the caller is its owner or an admin (settings, guests, export); refuses members.
 * `write` also refuses a workspace scheduled for deletion (read-only until the owner cancels).
 */
export async function requireWorkspaceManager(ctx: Ctx, profile: Doc<"profiles">, workspacePublicId: string, opts: { write?: boolean } = {}): Promise<{ workspace: Doc<"workspaces">; member: Doc<"workspaceMembers"> }> {
  const found = await requireWorkspace(ctx, profile, workspacePublicId);
  if (!canManageWorkspace(found.member)) fail("forbidden", MANAGER_ONLY);
  if (opts.write && isScheduledForDeletion(found.workspace)) fail("forbidden", DELETION_SCHEDULED_MESSAGE);
  return found;
}

/** A label for a stored role, e.g. for admin views ("member" for the old member roles). */
export function roleLabel(role: WorkspaceRole): string {
  const r = normalizeMembership({ role }).role;
  return r === "owner" ? "Owner" : r === "admin" ? "Admin" : "Member";
}

/** Access words for a page grant or a member's access. */
export const ACCESS_WORDS: Record<Access, string> = { none: "No access", read: "Can view", comment: "Can comment", write: "Can edit", manage: "Full access" };
