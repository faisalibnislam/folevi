// Profile pictures and workspace logos: small square images stored as `files` rows (kind "avatar" / "logo").
// A profile's avatar is a Personal file (it counts toward that person's personal storage); a team logo
// lives in (and counts toward) the team workspace.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { adjustStorageUsed } from "./entitlements";
import { fail } from "./errors";
import { signFileUrl } from "./fileUrls";
import { bump } from "./metrics";
import { inScope, scopeOfRow, type Scope } from "./scope";

/** Upload limit for avatars and logos. */
export const MAX_IDENTITY_IMAGE_BYTES = 2 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** The picture shown for a team workspace: its logo. */
export async function workspaceLogoUrl(ctx: QueryCtx, workspace: Doc<"workspaces">): Promise<string | null> {
  return await identityImageUrl(ctx, workspace.logoFileId);
}

/**
 * Resolves a just-uploaded avatar/logo by its public id and checks it may be used here: the caller
 * uploaded it, it is of the expected kind, it belongs to the expected scope (avatars: the caller's
 * Personal; logos: the team workspace) and isn't attached to a page.
 */
export async function claimIdentityImage(ctx: MutationCtx, profile: Doc<"profiles">, publicFileId: string, kind: "avatar" | "logo", scope: Scope): Promise<Doc<"files">> {
  const file = await ctx.db
    .query("files")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicFileId))
    .unique();
  if (!file || file.status !== "ready" || file.uploadedBy !== profile._id || file.kind !== kind || !inScope(file, scope) || file.documentId) {
    fail("not_found", "That image wasn't found. Upload it again.");
  }
  return file;
}

/** Deletes a stored avatar/logo and gives its bytes back to its scope's storage. */
export async function deleteIdentityImage(ctx: MutationCtx, fileId: Id<"files"> | undefined): Promise<void> {
  if (!fileId) return;
  const file = await ctx.db.get(fileId);
  if (!file) return;
  await ctx.storage.delete(file.storageId);
  await adjustStorageUsed(ctx, scopeOfRow(file), -file.size);
  await bump(ctx, "storage_bytes", -file.size);
  await ctx.db.delete(file._id);
}

/** How to name a workspace to someone who isn't in it yet (invitations, invite previews). */
export function workspaceLabel(workspace: Doc<"workspaces">): string {
  return workspace.name;
}
