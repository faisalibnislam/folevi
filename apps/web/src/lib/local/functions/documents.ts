// documents.* in local mode (convex/documents.ts). One person owns the whole library, so access is always
// full and nothing is filtered for a reader; the shapes, orders and errors are the server's. Version history
// is in documents.history.ts.
import { cloneBlocks, rankBetween, ulid, type SyncOp } from "@folevi/editor-schema";
import type { FunctionReturnType, PaginationResult } from "convex/server";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { newestFirst, oldestFirst, paginate, sortKey } from "../paginate";
import { defineLocal, type LocalMutationCtx, type LocalReader } from "../registry";
import type { LocalDocument, LocalRecent } from "../store";
import { versionsOf } from "./documents.history";
import { applyOps } from "./sync";
import { copyCollectionsInto } from "./collections";
import { checkScope, HomeFolders, insertDocument, liveBlocks, refreshSourcesShownBy, requireProfile, toSummary, toWireBlock, withExtras, type DocumentWithExtras, type LocalProfile } from "./shared";

type ListView = "all" | "starred" | "archive" | "trash" | "templates" | "daily" | "unsorted" | "folder" | "tag";
type ListSort = "updated" | "created" | "title" | "manual";

/** Notes in Trash longer than this are deleted for good (the server's maintenance.purgeExpiredTrash). */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** How often the library looks for them (there's no cron on a device: mutations that touch notes check). */
const TRASH_PURGE_EVERY_MS = 60 * 60 * 1000;

const listedKinds = (d: LocalDocument) => d.kind === "document" || d.kind === "daily";
/** Top-level pages of the lists (All, Recent notes): pages and dailies, not archived, not nested. */
const listedPage = (d: LocalDocument) => listedKinds(d) && d.archivedAt === null && d.parentDocumentId === null;

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
      return listedPage(d) && d.folderId === null && !d.inTrash;
    case "all":
      return listedPage(d) && !d.inTrash;
  }
}

/**
 * The sort key of a note in a list walked through the server's sort indexes (ascending keys walk the list in
 * its order): ties by creation, newest first in the time sorts, oldest first by title and by hand. Titles
 * are compared as the index does, byte-wise.
 */
function keyFor(sort: ListSort): (d: LocalDocument) => string {
  switch (sort) {
    case "created":
      return (d) => sortKey(newestFirst(d.createdAt), newestFirst(d.ordinal), d.id);
    case "title":
      return (d) => sortKey(d.title, oldestFirst(d.ordinal), d.id);
    case "manual":
      return (d) => sortKey(d.rank, oldestFirst(d.ordinal), d.id);
    default:
      return (d) => sortKey(newestFirst(d.updatedAt), newestFirst(d.ordinal), d.id);
  }
}

/** The order a sort index walks notes in, as a comparison (ties by creation in the index's direction). */
function indexOrder(sort: ListSort) {
  return (a: LocalDocument, b: LocalDocument) => {
    switch (sort) {
      case "created":
        return b.createdAt - a.createdAt || b.ordinal - a.ordinal;
      case "title":
        return a.title < b.title ? -1 : a.title > b.title ? 1 : a.ordinal - b.ordinal;
      case "manual":
        return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.ordinal - b.ordinal;
      default:
        return b.updatedAt - a.updatedAt || b.ordinal - a.ordinal;
    }
  };
}

/** The order a list asks for, without a tie-break (a stable sort keeps the order notes were read in). */
function sorter(sort: ListSort) {
  return (a: LocalDocument, b: LocalDocument) => {
    switch (sort) {
      case "created":
        return b.createdAt - a.createdAt;
      case "title":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      case "manual":
        return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
      default:
        return b.updatedAt - a.updatedAt;
    }
  };
}

const byCreation = (a: LocalDocument, b: LocalDocument) => a.ordinal - b.ordinal;

/** The position an offset cursor names (a cursor from another kind of list starts over). */
function offsetOf(cursor: string | null): number {
  const n = cursor ? Number(cursor) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

type ListResult = PaginationResult<DocumentWithExtras>;

defineLocal(api.documents.list, "query", async (ctx, args): Promise<ListResult> => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const view = args.view as ListView;
  const sort = (args.sort ?? "updated") as ListSort;
  if (view === "folder") {
    const folder = args.folderId ? await ctx.db.get("folders", args.folderId) : undefined;
    if (!folder || folder.deletedAt !== null) fail("not_found", "Folder not found.");
  }
  if (view === "tag") {
    const tag = args.tagId ? (await ctx.db.list("tags")).find((t) => t.id === args.tagId) : undefined;
    if (!tag) fail("not_found", "Tag not found.");
  }
  const docs = (await ctx.db.list("documents")).filter((d) => inView(d, view, { folderId: args.folderId, tagId: args.tagId }));

  // Views the server reads whole from small per-person sets (stars, a folder, a tag, templates, the Archive)
  // are sorted in full and paged by position, as there.
  if (view === "starred" || view === "folder" || view === "tag" || view === "templates" || view === "archive") {
    let read: LocalDocument[];
    if (view === "starred") read = docs.sort((a, b) => (b.starOrder ?? 0) - (a.starOrder ?? 0)).slice(0, 500);
    else if (view === "folder") read = docs.sort((a, b) => a.updatedAt - b.updatedAt || byCreation(a, b)).slice(0, 1000);
    else read = docs.sort(byCreation).slice(0, view === "tag" ? 1000 : 2000);
    // Templates and the Archive keep their sort index's order (titles byte-wise, re-sorted case-insensitively
    // only when the list fits one page).
    const indexed = view === "templates" || view === "archive";
    read.sort(indexed ? indexOrder(sort) : sorter(sort));
    const start = offsetOf(args.paginationOpts.cursor);
    let page = read.slice(start, start + args.paginationOpts.numItems);
    const end = start + page.length;
    if (indexed && sort === "title" && start === 0 && end >= read.length) page = [...page].sort(sorter(sort));
    return { page: await withExtras(ctx.db, profile.id, page), isDone: end >= read.length, continueCursor: String(end) };
  }

  // The rest walk the server's sort indexes, so pages never overlap or skip (sort-key cursors here).
  const result = paginate(docs, keyFor(sort), args.paginationOpts);
  let page = result.page;
  // Titles are indexed byte-wise (capitals first): when the whole list fits in one page, it's ordered
  // case-insensitively.
  if (sort === "title" && result.isDone && !args.paginationOpts.cursor) page = [...page].sort(sorter(sort));
  return { ...result, page: await withExtras(ctx.db, profile.id, page) };
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
    if (!d.parentDocumentId) continue;
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
    // The first 100 made (the server's by_parent index), then those in Trash and rows left out.
    const kids = (children.get(page.id) ?? [])
      .sort(byCreation)
      .slice(0, 100)
      .filter((k) => !k.inTrash && k.kind !== "collectionRow");
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
  const kids = (await ctx.db.list("documents"))
    .filter((d) => d.parentDocumentId === doc.id)
    .sort(byCreation)
    .slice(0, 500)
    .filter((d) => !d.inTrash && d.kind !== "collectionRow");
  return kids.map((k) => toSummary(k, profile.id));
});

/** Backlinks (notes linking here) and unlinked mentions (notes mentioning the title). */
defineLocal(api.documents.backlinks, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return { linked: [], unlinked: [] };
  const all = await ctx.db.list("documents");
  // In the order the links were made (one entry per note, at its first link).
  const sources = all
    .flatMap((d) => {
      const first = (d.links ?? []).filter((l) => l.target === doc.id).reduce((min, l) => Math.min(min, l.ordinal), Infinity);
      return first === Infinity ? [] : [{ d, first }];
    })
    .sort((a, b) => a.first - b.first)
    .slice(0, 200)
    .map((s) => s.d);
  const seen = new Set<string>();
  const linked: { id: string; title: string; icon: string | null; excerpt: string }[] = [];
  for (const src of sources) {
    seen.add(src.id);
    if (src.inTrash) continue;
    linked.push({ id: src.id, title: src.title, icon: src.icon, excerpt: src.excerpt.slice(0, 140) });
  }
  const unlinked: typeof linked = [];
  const title = doc.title.trim();
  if (title.length >= 3) {
    const needle = title.toLowerCase();
    const hits = all.filter((h) => !h.inTrash && h.searchText.toLowerCase().includes(needle)).sort(byCreation);
    for (const h of hits.slice(0, 30)) {
      if (h.id === doc.id || seen.has(h.id)) continue;
      unlinked.push({ id: h.id, title: h.title, icon: h.icon, excerpt: h.excerpt.slice(0, 140) });
    }
  }
  return { linked, unlinked };
});

/** Info inspector: counts, times and recent activity (the versions saved). No content. */
defineLocal(api.documents.info, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const activity = (await versionsOf(ctx.db, doc.id)).slice(0, 10).map((s) => ({ kind: "snapshot" as const, at: s.createdAt, by: profile.displayName, reason: s.reason }));
  return {
    wordCount: doc.wordCount,
    charCount: doc.charCount,
    blockCount: doc.blockCount,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: profile.displayName,
    lastEditedBy: profile.displayName,
    activity,
  };
});

// ---------------------------------------------------------------- recents

const RECENT_ORDINAL_KEY = "recentOrdinal";
/** Opening a note again within this long of last opening it doesn't move it in Recent. */
const VIEW_STALE_MS = 30_000;
const MAX_RECENT_BATCH = 50;

defineLocal(api.documents.recent, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const rows = (await ctx.db.list("recents"))
    .filter((r) => r.viewedAt !== null)
    .sort((a, b) => b.viewedAt! - a.viewedAt! || b.ordinal - a.ordinal)
    .slice(0, 60);
  const homes = new HomeFolders(ctx.db);
  const out: (ReturnType<typeof toSummary> & { homeFolder: Awaited<ReturnType<HomeFolders["of"]>> })[] = [];
  for (const r of rows) {
    const d = await ctx.db.get("documents", r.documentId);
    if (!d || d.inTrash) continue;
    out.push({ ...toSummary(d, profile.id), homeFolder: await homes.of(d) });
    if (out.length >= Math.min(args.limit ?? 8, 30)) break;
  }
  return out;
});

async function recentRow(ctx: LocalMutationCtx, documentId: string): Promise<LocalRecent> {
  const existing = await ctx.db.get("recents", documentId);
  if (existing) return existing;
  return { documentId, viewedAt: null, ordinal: 0, hiddenAt: null };
}

defineLocal(api.documents.recordView, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return null;
  await purgeExpiredTrash(ctx);
  const now = ctx.now();
  const row = await recentRow(ctx, doc.id);
  // Opening a note removed from Recent notes brings it back there.
  let next: LocalRecent = { ...row, hiddenAt: null };
  if (row.viewedAt === null) {
    const ordinal = (((await ctx.db.get("meta", RECENT_ORDINAL_KEY)) as number | undefined) ?? 0) + 1;
    ctx.db.put("meta", RECENT_ORDINAL_KEY, ordinal);
    next = { ...next, viewedAt: now, ordinal };
  } else if (now - row.viewedAt > VIEW_STALE_MS) next = { ...next, viewedAt: now };
  if (next.viewedAt !== row.viewedAt || next.hiddenAt !== row.hiddenAt) ctx.db.put("recents", doc.id, next);
  return null;
});

/**
 * Home's "Recent notes": the most recently edited notes, minus the ones removed from the list (until they're
 * edited again or reopened).
 */
defineLocal(api.documents.recentNotes, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const limit = Math.max(1, Math.min(args.limit ?? 10, 30));
  const hidden = new Map(
    (await ctx.db.list("recents"))
      .filter((r) => r.hiddenAt !== null)
      .slice(0, 500)
      .map((r) => [r.documentId, r.hiddenAt!]),
  );
  const key = keyFor("updated");
  const candidates = (await ctx.db.list("documents"))
    .filter((d) => !d.inTrash && listedPage(d))
    .map((d) => ({ d, k: key(d) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, Math.min(200, limit * 2 + hidden.size))
    .map((c) => c.d);
  const shown = candidates.filter((d) => {
    const at = hidden.get(d.id);
    return at === undefined || d.updatedAt > at;
  });
  return await withExtras(ctx.db, profile.id, shown.slice(0, limit));
});

defineLocal(api.documents.hideFromRecent, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  if (args.documentIds.length > MAX_RECENT_BATCH) fail("limit_exceeded", `At most ${MAX_RECENT_BATCH} notes at a time.`);
  const now = ctx.now();
  let hidden = 0;
  for (const id of new Set(args.documentIds)) {
    const doc = await ctx.db.get("documents", id);
    if (!doc) continue;
    ctx.db.put("recents", doc.id, { ...(await recentRow(ctx, doc.id)), hiddenAt: now });
    hidden++;
  }
  return { hidden };
});

defineLocal(api.documents.showInRecent, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  if (args.documentIds.length > MAX_RECENT_BATCH) fail("limit_exceeded", `At most ${MAX_RECENT_BATCH} notes at a time.`);
  for (const id of new Set(args.documentIds)) {
    const row = await ctx.db.get("recents", id);
    if (!row || row.hiddenAt === null) continue;
    if (row.viewedAt === null) ctx.db.remove("recents", id);
    else ctx.db.put("recents", id, { ...row, hiddenAt: null });
  }
  return null;
});

// ---------------------------------------------------------------- changes to a note

async function requireDoc(db: LocalReader, id: string): Promise<LocalDocument> {
  const doc = await db.get("documents", id);
  if (!doc) fail("not_found", "Document not found.");
  return doc;
}

/** An edit of the note's own row: a new revision and change counter, edited now by this device. */
async function touchDoc(ctx: LocalMutationCtx, doc: LocalDocument, patch: Partial<LocalDocument>): Promise<LocalDocument> {
  const next = { ...doc, ...patch, seq: await ctx.nextSeq(), revision: doc.revision + 1, updatedAt: ctx.now(), editedByDevice: ctx.deviceId };
  ctx.db.put("documents", next.id, next);
  return next;
}

const STAR_ORDER_KEY = "starOrder";

/** Stars or unstars a note. A star isn't an edit: the note's revision and edited time stay. */
async function setStar(ctx: LocalMutationCtx, doc: LocalDocument, starred: boolean): Promise<void> {
  if (starred === doc.starred) return;
  let starOrder: number | null = null;
  if (starred) {
    starOrder = (((await ctx.db.get("meta", STAR_ORDER_KEY)) as number | undefined) ?? 0) + 1;
    ctx.db.put("meta", STAR_ORDER_KEY, starOrder);
  }
  ctx.db.put("documents", doc.id, { ...doc, starred, starOrder });
}

defineLocal(api.documents.setStarred, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  await setStar(ctx, await requireDoc(ctx.db, args.documentId), args.starred);
  return null;
});

defineLocal(api.documents.setArchived, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await requireDoc(ctx.db, args.documentId);
  await touchDoc(ctx, doc, { archivedAt: args.archived ? ctx.now() : null });
  return null;
});

/** Every note nested under `root` (pages and collection rows), at most 2000, nearest first. */
async function descendantsOf(db: LocalReader, root: LocalDocument): Promise<LocalDocument[]> {
  const all = await db.list("documents");
  const kids = new Map<string, LocalDocument[]>();
  for (const d of all) if (d.parentDocumentId) kids.set(d.parentDocumentId, [...(kids.get(d.parentDocumentId) ?? []), d]);
  const out: LocalDocument[] = [];
  const queue = [root.id];
  while (queue.length && out.length < 2000) {
    for (const k of kids.get(queue.shift()!) ?? []) {
      out.push(k);
      queue.push(k.id);
    }
  }
  return out;
}

/**
 * A note and the pages inside it go to Trash together (`stamp` is when), or come back: restoring brings back
 * only the pages that went with it. Synced content they show follows them (shared.ts refreshSourcesShownBy).
 */
async function setTrashState(ctx: LocalMutationCtx, doc: LocalDocument, inTrash: boolean, stamp: number | null): Promise<void> {
  const seq = await ctx.nextSeq();
  const now = ctx.now();
  const all = [doc, ...(await descendantsOf(ctx.db, doc))];
  for (const d of all) {
    if (!inTrash && d.id !== doc.id && d.deletedAt !== doc.deletedAt) continue;
    ctx.db.put("documents", d.id, { ...d, inTrash, deletedAt: stamp, seq, revision: d.revision + 1, updatedAt: now });
  }
  await refreshSourcesShownBy(
    ctx,
    all.map((d) => d.id),
  );
}

/** Brings a note back from Trash (to the top level when its parent is still there or gone). */
async function restoreDoc(ctx: LocalMutationCtx, doc: LocalDocument): Promise<void> {
  if (!doc.inTrash) return;
  let root = doc;
  if (doc.parentDocumentId) {
    const parent = await ctx.db.get("documents", doc.parentDocumentId);
    if (!parent || parent.inTrash) root = { ...doc, parentDocumentId: null };
  }
  await setTrashState(ctx, root, false, null);
}

/**
 * Deletes a note for good, with the pages inside it, their blocks, versions and place in Recent. Files stay
 * until nothing refers to them (plan §3.8). The library keeps a stub so another device's copy doesn't bring it
 * back (packages/local-store).
 */
async function purgeNote(ctx: LocalMutationCtx, id: string, depth = 0): Promise<void> {
  if (depth > 64) return;
  for (const child of (await ctx.db.list("documents")).filter((d) => d.parentDocumentId === id)) await purgeNote(ctx, child.id, depth + 1);
  for (const b of await ctx.db.list("blocks", id)) ctx.db.remove("blocks", b.id, id);
  for (const v of await ctx.db.list("versions", id)) ctx.db.remove("versions", v.id, id);
  if (await ctx.db.get("recents", id)) ctx.db.remove("recents", id);
  ctx.db.remove("documents", id);
}

/** The notes in Trash whose deletion doesn't come with a parent's (their parent isn't in Trash). */
async function trashRoots(db: LocalReader, docs: LocalDocument[]): Promise<LocalDocument[]> {
  const byId = new Map((await db.list("documents")).map((d) => [d.id, d]));
  return docs.filter((d) => d.inTrash && !(d.parentDocumentId && byId.get(d.parentDocumentId)?.inTrash));
}

/** Notes in Trash for more than 30 days are deleted for good (checked at most once an hour). */
async function purgeExpiredTrash(ctx: LocalMutationCtx): Promise<void> {
  const now = ctx.now();
  const last = (await ctx.db.get("meta", "trashPurgedAt")) as number | undefined;
  if (last !== undefined && now - last < TRASH_PURGE_EVERY_MS && last <= now) return;
  ctx.db.put("meta", "trashPurgedAt", now);
  const cutoff = now - TRASH_RETENTION_MS;
  const expired = (await ctx.db.list("documents")).filter((d) => d.inTrash && d.deletedAt !== null && d.deletedAt < cutoff);
  for (const d of await trashRoots(ctx.db, expired)) await purgeNote(ctx, d.id);
}

defineLocal(api.documents.moveToTrash, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await requireDoc(ctx.db, args.documentId);
  if (doc.inTrash) return null;
  await setTrashState(ctx, doc, true, ctx.now());
  await purgeExpiredTrash(ctx);
  return null;
});

defineLocal(api.documents.restoreFromTrash, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  await restoreDoc(ctx, await requireDoc(ctx.db, args.documentId));
  return null;
});

/** Permanent deletion: the note must be in Trash and its title typed back. */
defineLocal(api.documents.deletePermanently, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await requireDoc(ctx.db, args.documentId);
  if (!doc.inTrash) fail("invalid_argument", "Move the document to Trash first.");
  if (args.confirmTitle.trim() !== (doc.title.trim() || "Untitled")) fail("invalid_argument", "Type the document title to confirm.");
  await purgeNote(ctx, doc.id);
  return null;
});

const TRASH_COUNT_CAP = 500;

/** How many notes are in Trash and how many emptying it deletes (all of them: the library is the person's). */
defineLocal(api.documents.trashSummary, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const key = keyFor("created");
  const trashed = (await ctx.db.list("documents"))
    .filter((d) => d.inTrash)
    .sort((a, b) => (key(a) < key(b) ? -1 : 1))
    .slice(0, TRASH_COUNT_CAP + 1)
    .filter((d) => d.kind !== "synced");
  const total = Math.min(trashed.length, TRASH_COUNT_CAP);
  return { total, deletable: total, more: trashed.length > TRASH_COUNT_CAP };
});

/**
 * Empties Trash at once. (The server deletes in pages of 100 in the background and says `continuing` while
 * it does; a device has no limit to page around, so it's always done.)
 */
defineLocal(api.documents.emptyTrash, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const roots = await trashRoots(ctx.db, await ctx.db.list("documents"));
  for (const d of roots) await purgeNote(ctx, d.id);
  return { scheduled: roots.length, continuing: false };
});

/** A folder or parent change through the same document.update op offline clients send. */
async function moveDoc(ctx: LocalMutationCtx, profile: LocalProfile, doc: LocalDocument, patch: { folderId?: string | null; parentDocumentId?: string | null }) {
  const [r] = await applyOps(ctx, profile, [{ opId: ulid(), kind: "document.update", documentId: doc.id, patch, baseRevision: doc.revision } as SyncOp]);
  return r!;
}

defineLocal(api.documents.move, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const doc = await requireDoc(ctx.db, args.documentId);
  const patch: { folderId?: string | null; parentDocumentId?: string | null } = {};
  if (args.folderId !== undefined) patch.folderId = args.folderId;
  if (args.parentDocumentId !== undefined) patch.parentDocumentId = args.parentDocumentId;
  const r = await moveDoc(ctx, profile, doc, patch);
  if (r.status === "rejected") fail("invalid_argument", r.error?.message ?? "Could not move the document.");
  return null;
});

export const MAX_BULK = 50;

/**
 * One action on several notes at once (multi-select, dragging to a folder). Notes that can't take it (gone,
 * in Trash for a move or archive, not in Trash for a delete) are skipped and counted, never fatal.
 */
defineLocal(api.documents.bulkUpdate, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const action = args.action;
  let ids = [...new Set(args.documentIds)];
  if (ids.length > MAX_BULK) fail("limit_exceeded", `At most ${MAX_BULK} notes at a time.`);
  if (action.kind === "restore") {
    // Parents before their nested pages, so a restored page lands back under its parent.
    const depth = new Map<string, number>();
    for (const id of ids) {
      let d = 0;
      let cursor = await ctx.db.get("documents", id);
      while (cursor?.parentDocumentId && d < 12) {
        cursor = await ctx.db.get("documents", cursor.parentDocumentId);
        d++;
      }
      depth.set(id, d);
    }
    ids = [...ids].sort((a, b) => depth.get(a)! - depth.get(b)!);
  }
  const done: string[] = [];
  const previousFolders: Record<string, string | null> = {};
  if (!ids.length) return { done, skipped: 0, previousFolders };
  if (action.kind !== "star") await purgeExpiredTrash(ctx);
  let skipped = 0;
  const moves: LocalDocument[] = [];
  const deletions: string[] = [];
  for (const id of ids) {
    // Read now: an earlier note in this batch may have taken this one with it (a nested page).
    const doc = await ctx.db.get("documents", id);
    if (!doc) {
      skipped++;
      continue;
    }
    let ok = true;
    switch (action.kind) {
      case "move":
        // Applied together below; counted there.
        if (!doc.inTrash) {
          moves.push(doc);
          continue;
        }
        ok = false;
        break;
      case "star":
        await setStar(ctx, doc, action.starred);
        break;
      case "archive":
        if (doc.inTrash) ok = false;
        else if ((doc.archivedAt !== null) !== action.archived) await touchDoc(ctx, doc, { archivedAt: action.archived ? ctx.now() : null });
        break;
      case "trash":
        if (!doc.inTrash) await setTrashState(ctx, doc, true, ctx.now());
        break;
      case "restore":
        await restoreDoc(ctx, doc);
        break;
      case "delete":
        // Deleted after the loop, as the server's deletion jobs run after it: a nested page listed too is
        // still found (and counted) here.
        if (!doc.inTrash) ok = false;
        else deletions.push(doc.id);
        break;
    }
    if (ok) done.push(id);
    else skipped++;
  }
  if (moves.length) {
    const folderId = action.kind === "move" ? action.folderId : null;
    for (const d of moves) previousFolders[d.id] = d.folderId && (await ctx.db.get("folders", d.folderId)) ? d.folderId : null;
    const results = await applyOps(
      ctx,
      profile,
      moves.map((d) => ({ opId: ulid(), kind: "document.update" as const, documentId: d.id, patch: { folderId }, baseRevision: d.revision })),
    );
    results.forEach((r, i) => {
      const id = moves[i]!.id;
      if (r.status === "rejected") {
        skipped++;
        delete previousFolders[id];
      } else done.push(id);
    });
  }
  for (const id of deletions) await purgeNote(ctx, id);
  return { done, skipped, previousFolders };
});

/** Arranges a note between two others. Not an edit: a new revision so clients refresh, the edited time stays. */
defineLocal(api.documents.reorder, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await requireDoc(ctx.db, args.documentId);
  const after = args.afterDocumentId ? await ctx.db.get("documents", args.afterDocumentId) : undefined;
  const before = args.beforeDocumentId ? await ctx.db.get("documents", args.beforeDocumentId) : undefined;
  let rank: string;
  try {
    rank = rankBetween(after?.rank ?? null, before?.rank ?? null);
  } catch {
    rank = rankBetween(after?.rank ?? null, null);
  }
  ctx.db.put("documents", doc.id, { ...doc, rank, seq: await ctx.nextSeq(), revision: doc.revision + 1 });
  return { rank };
});

/** A copy of a note next to it ("Duplicate"), or a template made from it. */
defineLocal(api.documents.duplicate, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const doc = await requireDoc(ctx.db, args.documentId);
  const blocks = cloneBlocks(
    (await liveBlocks(ctx.db, doc.id))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(toWireBlock),
  );
  const copy = await insertDocument(ctx, {
    title: args.asTemplate ? doc.title : `${doc.title || "Untitled"} (copy)`,
    icon: doc.icon,
    kind: args.asTemplate ? "template" : doc.kind === "template" ? "template" : "document",
    folderId: doc.folderId,
    parentDocumentId: args.asTemplate ? null : doc.parentDocumentId,
    style: doc.style,
    // Its files are the original's: the bytes stay while any note refers to them (plan §3.8).
    cover: doc.cover,
    blocks,
  });
  // Its databases are its own, as on the server: rows edited in the copy don't change the original.
  await copyCollectionsInto(ctx, copy.id);
  return toSummary((await ctx.db.get("documents", copy.id)) ?? copy, profile.id);
});
