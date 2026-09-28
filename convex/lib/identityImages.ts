// Profile pictures and workspace logos: small square images stored as `files` rows (kind "avatar" / "logo").
// A profile's avatar lives in (and counts toward) that person's personal workspace; a team logo lives in
// the team workspace. Personal workspaces have no logo of their own: they show the owner's avatar.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";
import { signFileUrl } from "./fileUrls";
import { bump } from "./metrics";

/** Upload limit for avatars and logos. */
export const MAX_IDENTITY_IMAGE_BYTES = 2 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The person's one personal workspace (created at sign-up; never transferred). */
export async function personalWorkspaceOf(ctx: QueryCtx, profileId: Id<"profiles">): Promise<Doc<"workspaces"> | null> {
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", profileId))
    .collect();
  return owned.find((w) => w.kind === "personal" && w.status !== "deleting") ?? null;
}

/**
 * A signed URL for an avatar/logo, returned inside reactive queries. Query results don't re-run as time
 * passes, so the expiry is rounded to the day and kept long (at least a week) to stay valid while a tab
 * stays open.
 */
export async function identityImageUrl(ctx: QueryCtx, fileId: Id<"files"> | undefined): Promise<string | null> {
  if (!fileId) return null;
  const file = await ctx.db.get(fileId);
  if (!file || file.status !== "ready") return null;
  const exp = Math.floor(Date.now() / DAY_MS) * DAY_MS + 8 * DAY_MS;
  const sig = await signFileUrl(`${file.publicId}:${exp}`);
  return `${process.env.CONVEX_SITE_URL ?? ""}/files/${file.publicId}?exp=${exp}&sig=${sig}`;
}

/** The picture shown for a workspace: a team's logo, or a personal workspace owner's avatar. */
export async function workspaceLogoUrl(ctx: QueryCtx, workspace: Doc<"workspaces">): Promise<string | null> {
  if (workspace.kind === "team") return await identityImageUrl(ctx, workspace.logoFileId);
  const owner = await ctx.db.get(workspace.ownerId);
  return owner && owner.status !== "deleted" ? await identityImageUrl(ctx, owner.avatarFileId) : null;
}

/**
 * Resolves a just-uploaded avatar/logo by its public id and checks it may be used here: the caller
 * uploaded it, it is of the expected kind, it belongs to the expected workspace and isn't attached to a page.
 */
export async function claimIdentityImage(
  ctx: MutationCtx,
  profile: Doc<"profiles">,
  publicFileId: string,
  kind: "avatar" | "logo",
  workspaceId: Id<"workspaces">,
): Promise<Doc<"files">> {
  const file = await ctx.db
    .query("files")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicFileId))
    .unique();
  if (!file || file.status !== "ready" || file.uploadedBy !== profile._id || file.kind !== kind || file.workspaceId !== workspaceId || file.documentId) {
    fail("not_found", "That image wasn't found. Upload it again.");
  }
  return file;
}

/** Deletes a stored avatar/logo and gives its bytes back to the workspace's storage quota. */
export async function deleteIdentityImage(ctx: MutationCtx, fileId: Id<"files"> | undefined): Promise<void> {
  if (!fileId) return;
  const file = await ctx.db.get(fileId);
  if (!file) return;
  await ctx.storage.delete(file.storageId);
  const ws = await ctx.db.get(file.workspaceId);
  if (ws) await ctx.db.patch(ws._id, { storageUsedBytes: Math.max(0, ws.storageUsedBytes - file.size) });
  await bump(ctx, "storage_bytes", -file.size);
  await ctx.db.delete(file._id);
}

/**
 * How to name a workspace to someone who isn't its owner (invitations, invite previews). Every personal
 * workspace is called "Personal", so those read as "Ada's personal workspace".
 */
export async function workspaceLabel(ctx: QueryCtx, workspace: Doc<"workspaces">): Promise<string> {
  if (workspace.kind === "team") return workspace.name;
  const owner = await ctx.db.get(workspace.ownerId);
  const first = owner && owner.status !== "deleted" ? (owner.displayName.split(" ")[0] ?? owner.displayName) : "";
  return first ? `${first}’s personal workspace` : "a personal workspace";
}
