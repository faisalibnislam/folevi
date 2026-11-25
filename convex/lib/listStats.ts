// Folder and Drafts stats (the listStats table): how many pages each folder and each scope's Drafts lists,
// when a folder's pages last changed and its newest pages as card previews. Kept in step on every write to a
// note (lib/functions.ts calls documentWritten), so the folder views, Home and the sidebar's Drafts count read
// one row per folder instead of the folder's pages.
//
// A folder or scope without a row (made before stats existed, until migrations.backfillListStats has run)
// is counted from its pages as before. People who can't open every page of a scope get the stats only for
// folders without a restricted page hidden from them (lib/auth.ts PageReader); the others are counted live.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hasValidScope, insertScoped, scopeOfRow, type Scope } from "./scope";
import { sealedFieldsOf } from "./e2ee/sealedRows";

/** Newest pages kept per folder for its card. */
export const PREVIEWS = 5;

export type ListStats = Doc<"listStats">;
export type PreviewEntry = ListStats["previews"][number];

/** A folder's listed page: top level, not in Trash or the Archive, not a template (organization.index counts these). */
export function inFolderList(d: Doc<"documents">): boolean {
  return d.folderId !== undefined && d.parentDocumentId === undefined && !d.inTrash && d.archivedAt === undefined && d.kind !== "template";
}

/** A Draft: a page in no folder, top level, not in Trash or the Archive (organization.draftCount counts these). */
export function inDrafts(d: Doc<"documents">): boolean {
  return d.folderId === undefined && d.parentDocumentId === undefined && !d.inTrash && d.archivedAt === undefined && (d.kind === "document" || d.kind === "daily");
}

type Bucket = { folderId: Id<"folders"> } | { drafts: Scope };

function bucketOf(d: Doc<"documents"> | null): Bucket | null {
  if (!d || !hasValidScope(d)) return null;
  if (inFolderList(d)) return { folderId: d.folderId! };
  if (inDrafts(d)) return { drafts: scopeOfRow(d) };
  return null;
}

function sameBucket(a: Bucket, b: Bucket): boolean {
  if ("folderId" in a) return "folderId" in b && a.folderId === b.folderId;
  if (!("drafts" in b)) return false;
  const x = a.drafts;
  const y = b.drafts;
  return x.kind === "personal" ? y.kind === "personal" && x.profileId === y.profileId : y.kind === "workspace" && x.workspaceId === y.workspaceId;
}

/** A folder's stats row. */
export async function folderStats(ctx: QueryCtx, folderId: Id<"folders">): Promise<ListStats | null> {
  return await ctx.db
    .query("listStats")
    .withIndex("by_folder", (q) => q.eq("folderId", folderId))
    .unique();
}

/** A scope's Drafts stats row. */
export async function draftStats(ctx: QueryCtx, scope: Scope): Promise<ListStats | null> {
  const base = ctx.db.query("listStats");
  return await (
    scope.kind === "personal"
      ? base.withIndex("by_owner_folder", (q) => q.eq("ownerProfileId", scope.profileId).eq("folderId", undefined))
      : base.withIndex("by_workspace_folder", (q) => q.eq("workspaceId", scope.workspaceId).eq("folderId", undefined))
  ).unique();
}

/** Every stats row of a scope (its folders' and its Drafts'), by folder id ("" for Drafts). */
export async function scopeStats(ctx: QueryCtx, scope: Scope): Promise<Map<string, ListStats>> {
  const base = ctx.db.query("listStats");
  const rows = await (scope.kind === "personal" ? base.withIndex("by_owner_folder", (q) => q.eq("ownerProfileId", scope.profileId)) : base.withIndex("by_workspace_folder", (q) => q.eq("workspaceId", scope.workspaceId))).collect();
  return new Map(rows.map((r) => [r.folderId ?? "", r]));
}

const bucketRow = (ctx: QueryCtx, b: Bucket) => ("folderId" in b ? folderStats(ctx, b.folderId) : draftStats(ctx, b.drafts));

/** A page as its folder card shows it. */
export function previewEntry(d: Doc<"documents">): PreviewEntry {
  const sealed = sealedFieldsOf(d);
  return {
    documentId: d._id,
    updatedAt: d.updatedAt,
    created: d._creationTime,
    createdAt: d.createdAt,
    title: d.title,
    cover: d.cover,
    excerpt: d.excerpt.slice(0, 280),
    restricted: d.accessMode === "restricted" || undefined,
    ...(sealed ? { sealed } : {}),
  };
}

/** Newest first, then the earlier made (organization.index's order). */
const newestFirst = (a: { updatedAt: number; created: number }, b: { updatedAt: number; created: number }) => b.updatedAt - a.updatedAt || a.created - b.created;

/** A folder's newest listed pages, read from its pages. */
export async function readPreviews(ctx: QueryCtx, folderId: Id<"folders">): Promise<PreviewEntry[]> {
  const out: PreviewEntry[] = [];
  const rows = ctx.db
    .query("documents")
    .withIndex("by_folder_listed", (q) => q.eq("folderId", folderId).eq("parentDocumentId", undefined).eq("inTrash", false).eq("archivedAt", undefined))
    .order("desc");
  for await (const d of rows) {
    if (d.kind === "template") continue;
    out.push(previewEntry(d));
    // A few past the last kept, so ties in time are ordered as the cards order them.
    if (out.length >= PREVIEWS + 3) break;
  }
  return out.sort(newestFirst).slice(0, PREVIEWS);
}

/** Keeps the stats in step with one write to a note (`before`/`after` null: created / deleted). */
export async function documentWritten(ctx: MutationCtx, before: Doc<"documents"> | null, after: Doc<"documents"> | null): Promise<void> {
  const from = bucketOf(before);
  const to = bucketOf(after);
  if (from && to && sameBucket(from, to)) {
    // Still listed in the same place: only a folder's last change and previews can move.
    if ("folderId" in to) {
      const row = await folderStats(ctx, to.folderId);
      if (row) await touchFolder(ctx, row, before!, after!);
    }
    return;
  }
  if (from) {
    const row = await bucketRow(ctx, from);
    if (row) {
      const was = row.previews.some((e) => e.documentId === before!._id);
      await ctx.db.patch(row._id, { count: Math.max(0, row.count - 1), ...("folderId" in from && was ? { previews: await readPreviews(ctx, from.folderId) } : {}) });
    }
  }
  if (to) {
    const row = await bucketRow(ctx, to);
    if (row) {
      if ("folderId" in to) {
        await ctx.db.patch(row._id, { count: row.count + 1 });
        await touchFolder(ctx, { ...row, count: row.count + 1 }, null, after!);
      } else await ctx.db.patch(row._id, { count: row.count + 1 });
    }
  }
}

/** A listed page of the folder changed or arrived: its last change and its place among the previews. */
async function touchFolder(ctx: MutationCtx, row: ListStats, before: Doc<"documents"> | null, after: Doc<"documents">) {
  const lastEditedAt = Math.max(row.lastEditedAt ?? 0, after.updatedAt);
  const old = row.previews.find((e) => e.documentId === after._id);
  let previews: PreviewEntry[];
  if (old && after.updatedAt < old.updatedAt) {
    // Moved back in time (rare: an import keeping its dates): another page may now be newer.
    previews = await readPreviews(ctx, after.folderId!);
  } else {
    previews = [...row.previews.filter((e) => e.documentId !== after._id), previewEntry(after)].sort(newestFirst).slice(0, PREVIEWS);
  }
  const changed = lastEditedAt !== row.lastEditedAt || JSON.stringify(previews) !== JSON.stringify(row.previews);
  void before;
  if (changed) await ctx.db.patch(row._id, { lastEditedAt, previews });
}

/** A folder made starts its (empty) stats; a folder deleted for good takes them with it. */
export async function folderWritten(ctx: MutationCtx, before: Doc<"folders"> | null, after: Doc<"folders"> | null): Promise<void> {
  if (!before && after && hasValidScope(after)) {
    if (!(await folderStats(ctx, after._id))) await insertScoped(ctx, "listStats", scopeOfRow(after), { folderId: after._id, count: 0, previews: [] });
    return;
  }
  if (before && !after) {
    const row = await folderStats(ctx, before._id);
    if (row) await ctx.db.delete(row._id);
  }
}

/** A new Personal or workspace (no pages yet) starts its Drafts stats at zero. */
export async function scopeCreated(ctx: MutationCtx, scope: Scope): Promise<void> {
  if (!(await draftStats(ctx, scope))) await insertScoped(ctx, "listStats", scope, { count: 0, previews: [] });
}

/** Builds a folder's stats from its pages (migrations.backfillListStats). Nothing if it has them. */
export async function buildFolderStats(ctx: MutationCtx, folder: Doc<"folders">): Promise<boolean> {
  if (!hasValidScope(folder) || (await folderStats(ctx, folder._id))) return false;
  let count = 0;
  let lastEditedAt: number | undefined;
  const rows = ctx.db
    .query("documents")
    .withIndex("by_folder_listed", (q) => q.eq("folderId", folder._id).eq("parentDocumentId", undefined).eq("inTrash", false).eq("archivedAt", undefined));
  for await (const d of rows) {
    if (d.kind === "template") continue;
    count++;
    lastEditedAt = Math.max(lastEditedAt ?? 0, d.updatedAt);
  }
  await insertScoped(ctx, "listStats", scopeOfRow(folder), { folderId: folder._id, count, ...(lastEditedAt !== undefined ? { lastEditedAt } : {}), previews: await readPreviews(ctx, folder._id) });
  return true;
}

/** Builds a scope's Drafts count from its pages (migrations.backfillListStats). Nothing if it has one. */
export async function buildDraftStats(ctx: MutationCtx, scope: Scope): Promise<boolean> {
  if (await draftStats(ctx, scope)) return false;
  const base = ctx.db.query("documents");
  const rows =
    scope.kind === "personal"
      ? base.withIndex("by_owner_listed", (q) => q.eq("ownerProfileId", scope.profileId).eq("parentDocumentId", undefined).eq("inTrash", false).eq("archivedAt", undefined).eq("folderId", undefined))
      : base.withIndex("by_workspace_listed", (q) => q.eq("workspaceId", scope.workspaceId).eq("parentDocumentId", undefined).eq("inTrash", false).eq("archivedAt", undefined).eq("folderId", undefined));
  let count = 0;
  for await (const d of rows) if (d.kind === "document" || d.kind === "daily") count++;
  await insertScoped(ctx, "listStats", scope, { count, previews: [] });
  return true;
}
