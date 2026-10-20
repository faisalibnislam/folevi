// documents.* in local mode (convex/documents.ts). One person owns the whole library, so access is always
// full and nothing is filtered for a reader; the shapes are the server's.
import type { FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { newestFirst, oldestFirst, paginate, sortKey } from "../paginate";
import { defineLocal } from "../registry";
import type { LocalDocument } from "../store";
import { checkScope, requireProfile, toSummary, withExtras } from "./shared";

type ListView = "all" | "starred" | "archive" | "trash" | "templates" | "daily" | "unsorted" | "folder" | "tag";
type ListSort = "updated" | "created" | "title" | "manual";

const listedKinds = (d: LocalDocument) => d.kind === "document" || d.kind === "daily";

/** Whether a note belongs in a view (the filters of documents.list). */
function inView(d: LocalDocument, view: ListView, opts: { folderId?: string; tagId?: string }): boolean {
  switch (view) {
    case "trash":
      // Synced content no note shows waits in Trash too, but isn't a page to list.
      return d.inTrash && d.kind !== "synced";
    case "starred":
      return d.starred && !d.inTrash;
    case "folder":
      return d.folderId === opts.folderId && d.parentDocumentId === null && !d.inTrash && d.archivedAt === null && listedKinds(d);
    case "tag":
      return !d.inTrash && d.tagIds.includes(opts.tagId ?? "");
    case "templates":
      return d.kind === "template" && !d.inTrash;
    case "archive":
      return d.parentDocumentId === null && !d.inTrash && d.archivedAt !== null;
    case "daily":
      return d.kind === "daily" && !d.inTrash;
    case "unsorted":
      return listedKinds(d) && d.folderId === null && d.archivedAt === null && d.parentDocumentId === null && !d.inTrash;
    case "all":
      return listedKinds(d) && d.archivedAt === null && d.parentDocumentId === null && !d.inTrash;
  }
}

/**
 * The sort key of a note in a list (ascending keys walk the list in its order). Ties go as the server's
 * indexes break them, by creation: newest first in the time sorts, oldest first by title and by hand.
 */
function keyFor(sort: ListSort): (d: LocalDocument) => string {
  switch (sort) {
    case "created":
      return (d) => sortKey(newestFirst(d.createdAt), newestFirst(d.ordinal), d.id);
    case "title":
      return (d) => sortKey(d.title.toLocaleLowerCase(), d.title, oldestFirst(d.ordinal), d.id);
    case "manual":
      return (d) => sortKey(d.rank, oldestFirst(d.ordinal), d.id);
    default:
      return (d) => sortKey(newestFirst(d.updatedAt), newestFirst(d.ordinal), d.id);
  }
}

defineLocal(api.documents.list, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const view = args.view as ListView;
  if (view === "folder") {
    const folder = args.folderId ? await ctx.db.get("folders", args.folderId) : undefined;
    if (!folder || folder.deletedAt !== null) fail("not_found", "Folder not found.");
  }
  if (view === "tag") {
    const tag = args.tagId ? (await ctx.db.list("tags")).find((t) => t.id === args.tagId) : undefined;
    if (!tag) fail("not_found", "Tag not found.");
  }
  const docs = (await ctx.db.list("documents")).filter((d) => inView(d, view, { folderId: args.folderId, tagId: args.tagId }));
  const result = paginate(docs, keyFor((args.sort ?? "updated") as ListSort), args.paginationOpts);
  return { ...result, page: await withExtras(ctx.db, profile.id, result.page) };
});

defineLocal(api.documents.get, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return null;
  const breadcrumbs: { id: string; title: string; icon: string | null }[] = [];
  let cursor = doc.parentDocumentId ? await ctx.db.get("documents", doc.parentDocumentId) : undefined;
  let top = doc;
  for (let i = 0; cursor && i < 12; i++) {
    breadcrumbs.unshift({ id: cursor.id, title: cursor.title, icon: cursor.icon });
    top = cursor;
    cursor = cursor.parentDocumentId ? await ctx.db.get("documents", cursor.parentDocumentId) : undefined;
  }
  const [document] = await withExtras(ctx.db, profile.id, [doc]);
  // A nested page lives where its top-level note does (its own folder is never set).
  const folderId = doc.folderId ?? top.folderId;
  const folder = folderId ? await ctx.db.get("folders", folderId) : undefined;
  return {
    document: document!,
    access: "manage" as const,
    isMember: true,
    folder: folder && folder.deletedAt === null ? { id: folder.id, name: folder.name } : null,
    breadcrumbs,
    lastEditedBy: profile.displayName,
    createdByName: profile.displayName,
    inTrash: doc.inTrash,
  };
});

defineLocal(api.documents.titles, "query", async (ctx, args) => {
  const out: FunctionReturnType<typeof api.documents.titles> = {};
  for (const id of args.documentIds.slice(0, 200)) {
    const d = await ctx.db.get("documents", id);
    if (d) out[id] = { title: d.title, icon: d.icon, excerpt: d.excerpt, inTrash: d.inTrash, cover: d.cover, style: d.style };
  }
  return out;
});

/** At most this many pages in a note's page tree (documents.ts PAGE_TREE_LIMIT). */
const PAGE_TREE_LIMIT = 300;

defineLocal(api.documents.pageTree, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return null;
  const all = await ctx.db.list("documents");
  const byId = new Map(all.map((d) => [d.id, d]));
  let root = doc;
  for (let i = 0; root.parentDocumentId && i < 12; i++) {
    const parent = byId.get(root.parentDocumentId);
    if (!parent || parent.inTrash) break;
    root = parent;
  }
  const children = new Map<string, LocalDocument[]>();
  for (const d of all) {
    if (!d.parentDocumentId || d.inTrash || d.kind === "collectionRow") continue;
    const list = children.get(d.parentDocumentId) ?? [];
    list.push(d);
    children.set(d.parentDocumentId, list);
  }
  const pages: { id: string; title: string; parentId: string | null; depth: number }[] = [];
  let truncated = false;
  const walk = (page: LocalDocument, parentId: string | null, depth: number) => {
    if (pages.length >= PAGE_TREE_LIMIT) {
      truncated = true;
      return;
    }
    pages.push({ id: page.id, title: page.title, parentId, depth });
    if (depth >= 8) return;
    const kids = (children.get(page.id) ?? []).sort((a, b) => a.createdAt - b.createdAt || a.ordinal - b.ordinal).slice(0, 100);
    for (const k of kids) walk(k, page.id, depth + 1);
  };
  walk(root, null, 0);
  return { rootId: root.id, pages, truncated };
});

/** Children of a note (documents.children), used by page moves and the editor's page cards. */
defineLocal(api.documents.children, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const kids = (await ctx.db.list("documents")).filter((d) => d.parentDocumentId === doc.id && !d.inTrash && d.kind !== "collectionRow").slice(0, 500);
  return kids.map((k) => toSummary(k, profile.id));
});
