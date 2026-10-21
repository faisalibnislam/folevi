// End-to-end encryption guards shared by the core modules WP4 owns (docs/E2EE_DESIGN.md §5.7: search,
// collections, comments, sharing, tasks, study, exports, imports, maintenance, users, workspaces).
//
// Everything here builds on lib/e2ee/state.ts. A Standard space has no `e2eeSpaces` row and no sealed rows,
// so each check is at most one indexed read that finds nothing, and the old behaviour runs unchanged.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { scopeKey, type Scope } from "../scope";
import { addPending } from "./keyStore";
import { failE2ee, isSealed, requirePlainWrite, spaceE2ee } from "./state";

/** Whether a space is encrypted (level above Standard). A Standard space with locked notes is not. */
export async function isEncryptedSpace(ctx: QueryCtx, scope: Scope): Promise<boolean> {
  const space = await spaceE2ee(ctx, scope);
  return space !== null && space.level !== "standard";
}

/**
 * For server features the device does for sealed notes ("Device" and composed rows of §5.7): refuses a sealed
 * note with `e2ee_device_only` (the router composes it on the device), and a plaintext write into an encrypted
 * space with `e2ee_required` (an old client). Standard notes pass.
 */
export async function requireServerWritable(ctx: MutationCtx, doc: Doc<"documents">): Promise<void> {
  if (isSealed(doc)) failE2ee("e2ee_device_only");
  await requirePlainWrite(ctx, doc);
}

/** Refuses a sealed note for a server feature that reads it ("Device" rows): the device serves it. */
export function refuseSealed(doc: Doc<"documents">): void {
  if (isSealed(doc)) failE2ee("e2ee_device_only");
}

/**
 * Records that `profileId` needs a key in `scope` (§8.2 to §8.4): a member who joined (reason "joined"), a
 * page shared with someone who has no note key yet ("page", with the document), or a member removed so the
 * space key must change ("rotation"). Only for spaces that have E2EE set up; a row already waiting for the
 * same reason (and page) is reused (lib/e2ee/keyStore.ts addPending, WP2).
 */
export async function addPendingGrant(
  ctx: MutationCtx,
  scope: Scope,
  profileId: Id<"profiles">,
  reason: Doc<"e2eePendingGrants">["reason"],
  documentId?: Id<"documents">,
): Promise<boolean> {
  if (!(await spaceE2ee(ctx, scope))) return false;
  await addPending(ctx, scope, profileId, reason, documentId);
  return true;
}

/**
 * Someone stopped being a member of `scope` (removed, left, made a guest): their space key grants and the
 * grants still waiting for them go at once, so the server stops handing them keys (§8.3). Their pending page
 * grants stay (a guest keeps the pages shared with them). Returns whether the space has E2EE set up, so the
 * caller can ask for a rotation.
 */
export async function dropMemberKeys(ctx: MutationCtx, scope: Scope, profileId: Id<"profiles">): Promise<boolean> {
  if (!(await spaceE2ee(ctx, scope))) return false;
  const key = scopeKey(scope);
  const grants = await ctx.db
    .query("e2eeSpaceGrants")
    .withIndex("by_scope_profile", (q) => q.eq("scopeKey", key).eq("profileId", profileId))
    .collect();
  for (const g of grants) await ctx.db.delete(g._id);
  const waiting = await ctx.db
    .query("e2eePendingGrants")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .take(500);
  for (const p of waiting) if (p.scopeKey === key && p.reason !== "page") await ctx.db.delete(p._id);
  return true;
}

/** Deletes the note keys sealed to one person for one note (a page grant removed), and their pending page grant. */
export async function dropNoteGrant(ctx: MutationCtx, documentId: Id<"documents">, profileId: Id<"profiles">): Promise<void> {
  const keys = await ctx.db
    .query("e2eeNoteKeys")
    .withIndex("by_document_grantee", (q) => q.eq("documentId", documentId).eq("profileId", profileId))
    .collect();
  for (const k of keys) if (k.wrappedBy === "grant") await ctx.db.delete(k._id);
  const waiting = await ctx.db
    .query("e2eePendingGrants")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .take(200);
  for (const p of waiting) if (p.profileId === profileId) await ctx.db.delete(p._id);
}

/** Whether a person has encryption keys (an active account epoch, §4.7). */
export async function hasAccountKeys(ctx: QueryCtx, profileId: Id<"profiles">): Promise<boolean> {
  const rows = await ctx.db
    .query("e2eeAccounts")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .collect();
  return rows.some((r) => r.status === "active");
}

/** Whether `profileId` holds a note key for `doc` sealed to their account key (a page grant, §8.4). */
export async function hasNoteGrant(ctx: QueryCtx, documentId: Id<"documents">, profileId: Id<"profiles">): Promise<boolean> {
  const keys = await ctx.db
    .query("e2eeNoteKeys")
    .withIndex("by_document_grantee", (q) => q.eq("documentId", documentId).eq("profileId", profileId))
    .take(20);
  return keys.some((k) => k.wrappedBy === "grant");
}

/** A sealed field as results carry it: the ciphertext and its key version (never anything else). */
export function sealedFieldOut(f: { c: ArrayBuffer; k: number } | undefined): { c: ArrayBuffer; k: number } | null {
  return f ? { c: f.c, k: f.k } : null;
}

/** A sealed note's title as results carry it (with its MAC), for the router to open on the device. */
export function sealedTitleOut(doc: Doc<"documents">): { c: ArrayBuffer; k: number; mac: string } | null {
  return doc.sealedTitle ? { c: doc.sealedTitle.c, k: doc.sealedTitle.k, mac: doc.sealedTitle.mac } : null;
}
