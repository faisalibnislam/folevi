// Workspace capabilities that aren't about content (content access is lib/auth.ts documentAccess).
// Checked on the server by every function that needs them; the web app only mirrors them to hide controls.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { membership, requireWorkspace } from "./auth";
import { fail } from "./errors";

type Ctx = QueryCtx | MutationCtx;

/**
 * Who may see and change a workspace's plan and billing: its owner, and admins the owner allowed
 * ("Can manage billing" in Members). Members and guests never.
 */
export function memberCanManageBilling(member: Pick<Doc<"workspaceMembers">, "role" | "canManageBilling"> | null): boolean {
  if (!member) return false;
  return member.role === "owner" || (member.role === "admin" && member.canManageBilling === true);
}

/** Whether `profile` may manage `workspace`'s billing (see memberCanManageBilling). */
export async function canManageWorkspaceBilling(ctx: Ctx, profile: Doc<"profiles">, workspace: Doc<"workspaces">): Promise<boolean> {
  if (workspace.kind !== "team" || workspace.status === "deleting") return false;
  return memberCanManageBilling(await membership(ctx, profile._id, workspace._id));
}

export const BILLING_FORBIDDEN = "Only the workspace owner, or an admin they allow, can manage its plan and billing.";

/** The workspace (by public id) when the caller may manage its billing; refuses everyone else. */
export async function requireWorkspaceBilling(ctx: Ctx, profile: Doc<"profiles">, workspacePublicId: string): Promise<{ workspace: Doc<"workspaces">; member: Doc<"workspaceMembers"> }> {
  const found = await requireWorkspace(ctx, profile, workspacePublicId);
  if (!memberCanManageBilling(found.member)) fail("forbidden", BILLING_FORBIDDEN);
  return found;
}
