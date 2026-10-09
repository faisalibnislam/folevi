import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { rankBetween, ulid, type WireBlock } from "@folevi/editor-schema";
import {
  accessAtLeast,
  assertWritable,
  documentAccess,
  getDocumentByPublicId,
  membership,
  optionalProfile,
  requireDocument,
  requireProfile,
  requireRowScope,
  resolveScope,
  levelAtLeast,
  memberAtLeast,
  PageReader,
  type Access,
} from "./lib/auth";
import { HomeFolders, IdResolver, liveBlocks, Placement, refreshDerived, syncTaskProjection, toWireBlock, type DocumentSummary, type HomeFolder } from "./lib/documents";
import { SyncEngine, refreshLinkLabels, syncLinks } from "./lib/syncEngine";
import { ReaderLabels } from "./lib/linkLabels";
import { cloneBlocks, createDocument } from "./lib/create";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { SeqAllocator, nextSeq } from "./lib/seq";
import { copyCollectionsInto } from "./lib/collections";
import { inScope, insertScoped, scopeOfRow, vScope, vScopeArg, type Scope } from "./lib/scope";
import { vDocumentKind } from "./lib/validators";
import { People } from "./lib/authors";

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type ListView = "all" | "starred" | "archive" | "trash" | "templates" | "daily" | "unsorted" | "folder" | "tag";
type ListSort = "updated" | "created" | "title" | "manual";

/**
 * A scope's documents in or out of Trash, walked in `sort` order through its own index (Personal rows are
 * indexed by owner, workspace rows by workspace), so pagination covers the whole list in order.
 */
function scopeDocuments(ctx: QueryCtx | MutationCtx, scope: Scope, inTrash: boolean, sort: ListSort) {
  const base = ctx.db.query("documents");
  if (scope.kind === "personal") {
    const owner = scope.profileId;
    switch (sort) {
      case "created":
        return base.withIndex("by_owner_trash_created", (q) => q.eq("ownerProfileId", owner).eq("inTrash", inTrash)).order("desc");
      case "title":
        return base.withIndex("by_owner_trash_title", (q) => q.eq("ownerProfileId", owner).eq("inTrash", inTrash)).order("asc");
      case "manual":
        return base.withIndex("by_owner_trash_rank", (q) => q.eq("ownerProfileId", owner).eq("inTrash", inTrash)).order("asc");
      default:
        return base.withIndex("by_owner_trash", (q) => q.eq("ownerProfileId", owner).eq("inTrash", inTrash)).order("desc");
    }
  }
  const ws = scope.workspaceId;
  switch (sort) {
    case "created":
      return base.withIndex("by_workspace_trash_created", (q) => q.eq("workspaceId", ws).eq("inTrash", inTrash)).order("desc");
    case "title":
      return base.withIndex("by_workspace_trash_title", (q) => q.eq("workspaceId", ws).eq("inTrash", inTrash)).order("asc");
    case "manual":
      return base.withIndex("by_workspace_trash_rank", (q) => q.eq("workspaceId", ws).eq("inTrash", inTrash)).order("asc");
    default:
      return base.withIndex("by_workspace_trash", (q) => q.eq("workspaceId", ws).eq("inTrash", inTrash)).order("desc");
  }
}

/** A scope's daily notes of `owner` (retired feature; read-only). */
function scopeDailies(ctx: QueryCtx, scope: Scope, owner: Id<"profiles">, from: string, to: string) {
  const base = ctx.db.query("documents");
  return scope.kind === "personal"
    ? base.withIndex("by_owner_daily", (q) => q.eq("ownerProfileId", scope.profileId).eq("dailyOwnerId", owner).gte("dailyDate", from).lte("dailyDate", to))
    : base.withIndex("by_daily", (q) => q.eq("workspaceId", scope.workspaceId).eq("dailyOwnerId", owner).gte("dailyDate", from).lte("dailyDate", to));
}

/** Stars and scope tags loaded up front for a list (beyond these, withExtras looks each one up). */
const STAR_PRELOAD = 500;
const TAG_PRELOAD = 200;

/**
 * Each page's star, tags and home folder for the caller. For a list (`opts.scope`, several pages) the
 * caller's stars and the scope's tags are read once into maps, so a page costs one tag-link read; a
 * single page (or more stars or tags than are preloaded) is looked up one by one. `opts.starred` is the
 * complete set of starred page ids when the caller already has it (the Starred view).
 */
async function withExtras(ctx: QueryCtx, profile: Doc<"profiles">, ids: IdResolver, docs: Doc<"documents">[], opts: { scope?: Scope; starred?: Set<string> } = {}) {
  const out: (DocumentSummary & { starred: boolean; tags: { id: string; name: string; color: string }[]; homeFolder: HomeFolder | null })[] = [];
  const homes = new HomeFolders(ctx);
  const place = new Placement(ctx, profile);
  let starred = opts.starred ?? null;
  const tags = new Map<string, Doc<"tags"> | null>();
  if (opts.scope && docs.length > 1) {
    if (!starred) {
      const stars = await ctx.db
        .query("stars")
        .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
        .take(STAR_PRELOAD + 1);
      if (stars.length <= STAR_PRELOAD) starred = new Set(stars.map((s) => s.documentId as string));
    }
    const scope = opts.scope;
    const base = ctx.db.query("tags");
    const scopeTags = await (
      scope.kind === "personal" ? base.withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId)) : base.withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
    ).take(TAG_PRELOAD);
    for (const t of scopeTags) tags.set(t._id, t);
  }
  for (const d of docs) {
    const star = starred
      ? starred.has(d._id)
      : Boolean(
          await ctx.db
            .query("stars")
            .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", d._id))
            .unique(),
        );
    const tagLinks = await ctx.db
      .query("documentTags")
      .withIndex("by_document", (q) => q.eq("documentId", d._id))
      .take(20);
    const docTags = [];
    for (const l of tagLinks) {
      let t = tags.get(l.tagId);
      if (t === undefined) {
        t = await ctx.db.get(l.tagId);
        tags.set(l.tagId, t);
      }
      if (t) docTags.push({ id: t.publicId, name: t.name, color: t.color });
    }
    out.push({ ...(await place.summary(ids, d)), starred: star, tags: docTags, homeFolder: await homes.of(d) });
  }
  return out;
}

/** A scope's templates (any sort; the caller orders them). */
function scopeTemplates(ctx: QueryCtx, scope: Scope) {
  const base = ctx.db.query("documents");
  return scope.kind === "personal"
    ? base.withIndex("by_owner_kind", (q) => q.eq("ownerProfileId", scope.profileId).eq("kind", "template"))
    : base.withIndex("by_workspace_kind", (q) => q.eq("workspaceId", scope.workspaceId).eq("kind", "template"));
}

/** A scope's Archive: archived top-level pages not in Trash (archivedAt is a time, so >= 0 means set). */
function scopeArchive(ctx: QueryCtx, scope: Scope) {
  const base = ctx.db.query("documents");
  return scope.kind === "personal"
    ? base.withIndex("by_owner_listed", (q) => q.eq("ownerProfileId", scope.profileId).eq("parentDocumentId", undefined).eq("inTrash", false).gte("archivedAt", 0))
    : base.withIndex("by_workspace_listed", (q) => q.eq("workspaceId", scope.workspaceId).eq("parentDocumentId", undefined).eq("inTrash", false).gte("archivedAt", 0));
}

/** The position an offset cursor names (a cursor from another kind of list starts over). */
function offsetOf(cursor: string | null): number {
  const n = cursor ? Number(cursor) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Document lists of a scope (All, Starred, Archive, Trash, Templates, Daily, Drafts (no folder), folder, tag). */
export const list = query({
  args: {
    scope: vScopeArg,
    view: v.union(
      v.literal("all"),
      v.literal("starred"),
      v.literal("archive"),
      v.literal("trash"),
      v.literal("templates"),
      v.literal("daily"),
      v.literal("unsorted"),
      v.literal("folder"),
      v.literal("tag"),
    ),
    folderId: v.optional(v.string()),
    tagId: v.optional(v.string()),
    sort: v.optional(v.union(v.literal("updated"), v.literal("created"), v.literal("title"), v.literal("manual"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    const reader = new PageReader(ctx, profile, standing);
    const view = args.view as ListView;
    const ids = new IdResolver(ctx);
    const sort = args.sort ?? "updated";

    // Views backed by small per-person/per-container sets (read through their own indexes) are fetched
    // fully, then sorted.
    if (view === "starred" || view === "folder" || view === "tag" || view === "templates" || view === "archive") {
      let docs: Doc<"documents">[] = [];
      let starred: Set<string> | undefined;
      if (view === "starred") {
        const stars = await ctx.db
          .query("stars")
          .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
          .order("desc")
          .take(500);
        // Every page listed here is starred (withExtras needn't look the stars up again).
        starred = new Set(stars.map((s) => s.documentId as string));
        for (const s of stars) {
          const d = await ctx.db.get(s.documentId);
          if (d && inScope(d, scope) && !d.inTrash) docs.push(d);
        }
      } else if (view === "folder") {
        const folder = args.folderId
          ? await ctx.db
              .query("folders")
              .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId!))
              .unique()
          : null;
        if (!folder || !inScope(folder, scope)) fail("not_found", "Folder not found.");
        docs = (
          await ctx.db
            .query("documents")
            .withIndex("by_folder_listed", (q) => q.eq("folderId", folder._id).eq("parentDocumentId", undefined).eq("inTrash", false).eq("archivedAt", undefined))
            .take(1000)
        ).filter((d) => d.kind === "document" || d.kind === "daily");
      } else if (view === "templates") {
        docs = (await scopeTemplates(ctx, scope).take(2000)).filter((d) => !d.inTrash);
      } else if (view === "archive") {
        docs = await scopeArchive(ctx, scope).take(2000);
      } else {
        const tag = args.tagId
          ? await ctx.db
              .query("tags")
              .withIndex("by_public_id", (q) => q.eq("publicId", args.tagId!))
              .unique()
          : null;
        if (!tag || !inScope(tag, scope)) fail("not_found", "Tag not found.");
        const links = await ctx.db
          .query("documentTags")
          .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
          .take(1000);
        for (const l of links) {
          const d = await ctx.db.get(l.documentId);
          if (d && !d.inTrash) docs.push(d);
        }
      }
      docs = await reader.filter(docs);
      // Templates and the Archive keep the order the scope's sort indexes give (as they did when walked
      // through them): titles byte-wise, re-sorted case-insensitively only when the list fits one page.
      const indexed = view === "templates" || view === "archive";
      docs.sort(indexed ? indexOrder(sort) : sorter(sort));
      const start = offsetOf(args.paginationOpts.cursor);
      let page = docs.slice(start, start + args.paginationOpts.numItems);
      const end = start + page.length;
      if (indexed && sort === "title" && start === 0 && end >= docs.length) page = [...page].sort(sorter(sort));
      return {
        page: await withExtras(ctx, profile, ids, page, { scope, starred }),
        isDone: end >= docs.length,
        continueCursor: String(end),
      };
    }

    const inTrash = view === "trash";
    // Each sort has its own index so pagination walks the whole list in the requested order (sorting
    // one page at a time would only order within that page).
    const result = await scopeDocuments(ctx, scope, inTrash, sort)
      .filter((q) => {
        switch (view) {
          case "daily":
            return q.and(q.eq(q.field("kind"), "daily"), q.eq(q.field("dailyOwnerId"), profile._id));
          case "unsorted":
            // Daily notes (a retired feature) are ordinary pages now.
            return q.and(
              q.or(q.eq(q.field("kind"), "document"), q.eq(q.field("kind"), "daily")),
              q.eq(q.field("folderId"), undefined),
              q.eq(q.field("archivedAt"), undefined),
              q.eq(q.field("parentDocumentId"), undefined),
            );
          case "trash":
            return q.eq(q.field("kind"), q.field("kind"));
          default:
            return q.and(
              q.or(q.eq(q.field("kind"), "document"), q.eq(q.field("kind"), "daily")),
              q.eq(q.field("archivedAt"), undefined),
              q.eq(q.field("parentDocumentId"), undefined),
            );
        }
      })
      .paginate(args.paginationOpts);
    // Titles are indexed byte-wise (capitals first). When the whole list fits in one page, order it
    // case-insensitively; across pages the index order is kept so pages never overlap or skip.
    let page = await reader.filter(result.page);
    if (sort === "title" && result.isDone && !args.paginationOpts.cursor) page = [...page].sort(sorter(sort));
    return { ...result, page: await withExtras(ctx, profile, ids, page, { scope }) };
  },
});

/** The order a scope's sort index walks pages in (ties by creation, in the index's direction). */
function indexOrder(sort: ListSort) {
  return (a: Doc<"documents">, b: Doc<"documents">) => {
    switch (sort) {
      case "created":
        return b.createdAt - a.createdAt || b._creationTime - a._creationTime;
      case "title":
        return a.title < b.title ? -1 : a.title > b.title ? 1 : a._creationTime - b._creationTime;
      case "manual":
        return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a._creationTime - b._creationTime;
      default:
        return b.updatedAt - a.updatedAt || b._creationTime - a._creationTime;
    }
  };
}

function sorter(sort: ListSort) {
  return (a: Doc<"documents">, b: Doc<"documents">) => {
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

/** Document metadata, breadcrumbs and the caller's access. Blocks are a separate subscription (blocks.list). */
export const get = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) return null;
    const access = await documentAccess(ctx, profile, doc);
    if (access === "none") return null;
    const ids = new IdResolver(ctx);
    const breadcrumbs: { id: string; title: string; icon: string | null }[] = [];
    let cursor = doc.parentDocumentId ? await ctx.db.get(doc.parentDocumentId) : null;
    for (let i = 0; cursor && i < 12; i++) {
      if (accessAtLeast(await documentAccess(ctx, profile, cursor), "read")) {
        breadcrumbs.unshift({ id: cursor.publicId, title: cursor.title, icon: cursor.icon ?? null });
      }
      cursor = cursor.parentDocumentId ? await ctx.db.get(cursor.parentDocumentId) : null;
    }
    const scope = scopeOfRow(doc);
    // In the document's scope (its Personal's owner, or a member of its workspace), not only a guest on it.
    const inItsScope = scope.kind === "personal" ? scope.profileId === profile._id : Boolean(await membership(ctx, profile._id, scope.workspaceId));
    // A guest sees the page, not how the workspace (or someone's Personal) is organized: no folder, tag
    // or home-folder names. Nobody gets a parent they can't open (withExtras → Placement).
    const [extras] = await withExtras(ctx, profile, ids, [doc]);
    const document = inItsScope ? extras! : { ...extras!, folderId: null, tags: [], homeFolder: null };
    // A nested page lives where its top-level note does (its own folder is never set).
    let top = doc;
    for (let i = 0; top.parentDocumentId && i < 12; i++) {
      const parent = await ctx.db.get(top.parentDocumentId);
      if (!parent) break;
      top = parent;
    }
    const folderId = doc.folderId ?? top.folderId;
    const folder = inItsScope && folderId ? await ctx.db.get(folderId) : null;
    const lastEditor = await ctx.db.get(doc.lastEditedBy);
    const creator = await ctx.db.get(doc.createdBy);
    return {
      document,
      access,
      isMember: inItsScope,
      folder: folder && !folder.deletedAt ? { id: folder.publicId, name: folder.name } : null,
      breadcrumbs,
      lastEditedBy: lastEditor?.displayName ?? null,
      createdByName: creator?.displayName ?? null,
      inTrash: doc.inTrash,
    };
  },
});

/** Titles/icons for a set of documents (page cards, links, breadcrumbs). Unreadable ids are omitted. */
export const titles = query({
  args: { documentIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await optionalProfile(ctx);
    if (!profile) return {};
    const out: Record<string, { title: string; icon: string | null; excerpt: string; inTrash: boolean; cover: Doc<"documents">["cover"]; style: Doc<"documents">["style"] }> = {};
    for (const id of args.documentIds.slice(0, 200)) {
      const d = await getDocumentByPublicId(ctx, id);
      if (!d) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
      out[id] = { title: d.title, icon: d.icon ?? null, excerpt: d.excerpt, inTrash: d.inTrash, cover: d.cover, style: d.style };
    }
    return out;
  },
});

export const children = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const kids = await ctx.db
      .query("documents")
      .withIndex("by_parent", (q) => q.eq("parentDocumentId", doc._id))
      .take(500);
    const ids = new IdResolver(ctx);
    const reader = await PageReader.forScope(ctx, profile, scopeOfRow(doc));
    const readable = await reader.filter(kids.filter((k) => !k.inTrash && k.kind !== "collectionRow"));
    // A guest gets no folder ids (and the parent is this page, which they can open).
    const place = new Placement(ctx, profile);
    const out: DocumentSummary[] = [];
    for (const k of readable) out.push(await place.summary(ids, k));
    return out;
  },
});

/** At most this many pages in a note's page tree (the sidebar lists them all, so it stays small). */
const PAGE_TREE_LIMIT = 300;

/**
 * A note and all its nested pages, for the page tree in a note's sidebar: the top-level note this page
 * belongs to (the highest parent this person can open, without skipping one they can't) and every page
 * under it they can open, parents before children, in the order they were made.
 */
export const pageTree = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    // (A page made on this device may not have reached the server yet: no tree until it has.)
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    const reader = await PageReader.forScope(ctx, profile, scopeOfRow(doc));
    let root = doc;
    for (let i = 0; root.parentDocumentId && i < 12; i++) {
      const parent = await ctx.db.get(root.parentDocumentId);
      if (!parent || parent.inTrash || !(await reader.filter([parent])).length) break;
      root = parent;
    }
    const pages: { id: string; title: string; parentId: string | null; depth: number }[] = [];
    let truncated = false;
    const walk = async (page: Doc<"documents">, parentId: string | null, depth: number): Promise<void> => {
      if (pages.length >= PAGE_TREE_LIMIT) {
        truncated = true;
        return;
      }
      pages.push({ id: page.publicId, title: page.title, parentId, depth });
      if (depth >= 8) return;
      const kids = await ctx.db
        .query("documents")
        .withIndex("by_parent", (q) => q.eq("parentDocumentId", page._id))
        .take(100);
      const readable = await reader.filter(kids.filter((k) => !k.inTrash && k.kind !== "collectionRow"));
      for (const k of readable.sort((a, b) => a._creationTime - b._creationTime)) await walk(k, page.publicId, depth + 1);
    };
    await walk(root, null, 0);
    return { rootId: root.publicId, pages, truncated };
  },
});

/** Backlinks (documents linking here) and unlinked mentions (documents mentioning the title). */
export const backlinks = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return { linked: [], unlinked: [] };
    const links = await ctx.db
      .query("documentLinks")
      .withIndex("by_target", (q) => q.eq("targetPublicId", doc.publicId))
      .take(200);
    const seen = new Set<string>();
    const linked: { id: string; title: string; icon: string | null; excerpt: string }[] = [];
    for (const l of links) {
      if (seen.has(l.sourceDocumentId)) continue;
      seen.add(l.sourceDocumentId);
      const src = await ctx.db.get(l.sourceDocumentId);
      if (!src || src.inTrash) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, src), "read")) continue;
      linked.push({ id: src.publicId, title: src.title, icon: src.icon ?? null, excerpt: src.excerpt.slice(0, 140) });
    }
    const unlinked: typeof linked = [];
    const title = doc.title.trim();
    if (title.length >= 3) {
      const scope = scopeOfRow(doc);
      const phrase = `"${title.replace(/"/g, "")}"`;
      const hits = await ctx.db
        .query("documents")
        .withSearchIndex("search_text", (q) =>
          scope.kind === "personal"
            ? q.search("searchText", phrase).eq("ownerProfileId", scope.profileId).eq("inTrash", false)
            : q.search("searchText", phrase).eq("workspaceId", scope.workspaceId).eq("inTrash", false),
        )
        .take(30);
      const needle = title.toLowerCase();
      for (const h of hits) {
        if (h._id === doc._id || seen.has(h._id)) continue;
        if (!h.searchText.toLowerCase().includes(needle)) continue;
        if (!accessAtLeast(await documentAccess(ctx, profile, h), "read")) continue;
        unlinked.push({ id: h.publicId, title: h.title, icon: h.icon ?? null, excerpt: h.excerpt.slice(0, 140) });
      }
    }
    return { linked, unlinked };
  },
});

/** Info inspector: counts, timestamps and recent activity (snapshots and editors). No content. */
export const info = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const snapshots = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .order("desc")
      .take(10);
    const activity = [];
    for (const s of snapshots) {
      const who = await ctx.db.get(s.createdBy);
      activity.push({ kind: "snapshot" as const, at: s.createdAt, by: who?.displayName ?? "Someone", reason: s.reason });
    }
    const creator = await ctx.db.get(doc.createdBy);
    const editor = await ctx.db.get(doc.lastEditedBy);
    return {
      wordCount: doc.wordCount,
      charCount: doc.charCount,
      blockCount: doc.blockCount,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      createdBy: creator?.displayName ?? "Someone",
      lastEditedBy: editor?.displayName ?? "Someone",
      activity,
    };
  },
});

export const recent = query({
  args: { scope: vScopeArg, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const rows = await ctx.db
      .query("recents")
      .withIndex("by_profile_viewed", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(60);
    const ids = new IdResolver(ctx);
    const homes = new HomeFolders(ctx);
    const place = new Placement(ctx, profile);
    const out: (DocumentSummary & { homeFolder: HomeFolder | null })[] = [];
    for (const r of rows) {
      if (!inScope(r, scope)) continue;
      const d = await ctx.db.get(r.documentId);
      if (!d || d.inTrash) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
      out.push({ ...(await place.summary(ids, d)), homeFolder: await homes.of(d) });
      if (out.length >= Math.min(args.limit ?? 8, 30)) break;
    }
    return out;
  },
});

export const recordView = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    const existing = await ctx.db
      .query("recents")
      .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
      .unique();
    const now = Date.now();
    if (existing) {
      if (now - existing.viewedAt > 30_000) await ctx.db.patch(existing._id, { viewedAt: now });
    } else {
      await insertScoped(ctx, "recents", scopeOfRow(doc), { profileId: profile._id, documentId: doc._id, viewedAt: now });
    }
    // Opening a note removed from Recent notes brings it back there.
    const hidden = await ctx.db
      .query("recentHidden")
      .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
      .unique();
    if (hidden) await ctx.db.delete(hidden._id);
    return null;
  },
});

/**
 * Home's "Recent notes": the scope's most recently edited notes, minus the ones this person removed
 * from the list (until they're edited again or reopened; see recentHidden in the schema).
 */
export const recentNotes = query({
  args: { scope: vScopeArg, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    const limit = Math.max(1, Math.min(args.limit ?? 10, 30));
    const hiddenBase = ctx.db.query("recentHidden");
    const hiddenRows = await (
      scope.kind === "personal"
        ? hiddenBase.withIndex("by_profile_owner", (q) => q.eq("profileId", profile._id).eq("ownerProfileId", scope.profileId))
        : hiddenBase.withIndex("by_profile_workspace", (q) => q.eq("profileId", profile._id).eq("workspaceId", scope.workspaceId))
    ).take(500);
    const hidden = new Map(hiddenRows.map((h) => [h.documentId, h.hiddenAt]));
    const candidates = await scopeDocuments(ctx, scope, false, "updated")
      .filter((q) =>
        q.and(
          q.or(q.eq(q.field("kind"), "document"), q.eq(q.field("kind"), "daily")),
          q.eq(q.field("archivedAt"), undefined),
          q.eq(q.field("parentDocumentId"), undefined),
        ),
      )
      .take(Math.min(200, limit * 2 + hidden.size));
    const shown = candidates.filter((d) => {
      const at = hidden.get(d._id);
      return at === undefined || d.updatedAt > at;
    });
    const page = (await new PageReader(ctx, profile, standing).filter(shown)).slice(0, limit);
    return await withExtras(ctx, profile, new IdResolver(ctx), page, { scope });
  },
});

const MAX_RECENT_BATCH = 50;

/** Removes notes from this person's Recent notes on Home (nobody else's list changes). */
export const hideFromRecent = mutation({
  args: { documentIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (args.documentIds.length > MAX_RECENT_BATCH) fail("limit_exceeded", `At most ${MAX_RECENT_BATCH} notes at a time.`);
    const now = Date.now();
    let hidden = 0;
    for (const id of new Set(args.documentIds)) {
      const doc = await getDocumentByPublicId(ctx, id);
      if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) continue;
      const existing = await ctx.db
        .query("recentHidden")
        .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
        .unique();
      if (existing) await ctx.db.patch(existing._id, { hiddenAt: now });
      else await insertScoped(ctx, "recentHidden", scopeOfRow(doc), { profileId: profile._id, documentId: doc._id, hiddenAt: now });
      hidden++;
    }
    return { hidden };
  },
});

/** Undoes hideFromRecent. Only ever touches the caller's own rows. */
export const showInRecent = mutation({
  args: { documentIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (args.documentIds.length > MAX_RECENT_BATCH) fail("limit_exceeded", `At most ${MAX_RECENT_BATCH} notes at a time.`);
    for (const id of new Set(args.documentIds)) {
      const doc = await getDocumentByPublicId(ctx, id);
      if (!doc) continue;
      const row = await ctx.db
        .query("recentHidden")
        .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
        .unique();
      if (row) await ctx.db.delete(row._id);
    }
    return null;
  },
});

// ---------------------------------------------------------------- mutations

async function writableDoc(ctx: MutationCtx, publicId: string, need: "write" | "manage" = "write") {
  const profile = await requireProfile(ctx);
  await assertWritable(ctx, profile);
  const { doc } = await requireDocument(ctx, profile, publicId, need);
  return { profile, doc };
}

async function touchDoc(ctx: MutationCtx, doc: Doc<"documents">, patch: Partial<Doc<"documents">>, actor: Id<"profiles">) {
  const seq = await nextSeq(ctx, scopeOfRow(doc));
  await ctx.db.patch(doc._id, { ...patch, seq, revision: doc.revision + 1, updatedAt: Date.now(), lastEditedBy: actor });
}

/**
 * Online document creation in a scope: the caller's Personal, or a workspace where they can edit (offline
 * clients use sync.push with a document.create op). A nested page goes to its parent's scope.
 */
export const create = mutation({
  args: {
    scope: vScopeArg,
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    icon: v.optional(v.string()),
    kind: v.optional(vDocumentKind),
    parentDocumentId: v.optional(v.string()),
    folderId: v.optional(v.string()),
    templateId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await resolveScope(ctx, profile, args.scope, "edit");
    const engine = new SyncEngine(ctx, profile, "server");
    const [result] = await engine.applyAll(args.scope, [
      {
        opId: ulid(),
        kind: "document.create",
        document: {
          id: args.id ?? ulid(),
          parentDocumentId: args.parentDocumentId ?? null,
          folderId: args.folderId ?? null,
          kind: args.kind === "template" ? "template" : "document",
          title: args.title ?? "",
          icon: args.icon ?? null,
          templateId: args.templateId ?? null,
        },
      },
    ]);
    if (!result || result.status === "rejected") fail("invalid_argument", result?.error?.message ?? "Could not create the document.");
    return result.document!;
  },
});

export const setStarred = mutation({
  args: { documentId: v.string(), starred: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const existing = await ctx.db
      .query("stars")
      .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
      .unique();
    if (args.starred && !existing) {
      await insertScoped(ctx, "stars", scopeOfRow(doc), { profileId: profile._id, documentId: doc._id, createdAt: Date.now() });
    } else if (!args.starred && existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const setArchived = mutation({
  args: { documentId: v.string(), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { profile, doc } = await writableDoc(ctx, args.documentId);
    await touchDoc(ctx, doc, { archivedAt: args.archived ? Date.now() : undefined }, profile._id);
    return null;
  },
});

async function descendantsOf(ctx: QueryCtx | MutationCtx, root: Doc<"documents">): Promise<Doc<"documents">[]> {
  const out: Doc<"documents">[] = [];
  const queue: Id<"documents">[] = [root._id];
  while (queue.length && out.length < 2000) {
    const id = queue.shift()!;
    const kids = await ctx.db
      .query("documents")
      .withIndex("by_parent", (q) => q.eq("parentDocumentId", id))
      .collect();
    for (const k of kids) {
      out.push(k);
      queue.push(k._id);
    }
  }
  return out;
}

export async function setTrashState(ctx: MutationCtx, doc: Doc<"documents">, actor: Id<"profiles">, inTrash: boolean, stamp: number | undefined) {
  const seq = new SeqAllocator(ctx);
  const s = await seq.for(scopeOfRow(doc));
  const all = [doc, ...(await descendantsOf(ctx, doc))];
  for (const d of all) {
    // Restoring only brings back pages trashed together with the root.
    if (!inTrash && d._id !== doc._id && d.deletedAt !== doc.deletedAt) continue;
    await ctx.db.patch(d._id, {
      inTrash,
      deletedAt: stamp,
      deletedBy: inTrash ? actor : undefined,
      seq: s,
      revision: d.revision + 1,
      updatedAt: Date.now(),
    });
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_document", (q) => q.eq("documentId", d._id))
      .collect();
    for (const t of tasks) await ctx.db.patch(t._id, { documentInTrash: inTrash });
  }
}

export const moveToTrash = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const { profile, doc } = await writableDoc(ctx, args.documentId);
    if (doc.inTrash) return null;
    await setTrashState(ctx, doc, profile._id, true, Date.now());
    return null;
  },
});

/** Brings a trashed page back (with the pages trashed together with it). Callers check write access. */
async function restoreDoc(ctx: MutationCtx, doc: Doc<"documents">, actor: Id<"profiles">) {
  if (!doc.inTrash) return;
  // If the parent is still in Trash, restore to the top level.
  if (doc.parentDocumentId) {
    const parent = await ctx.db.get(doc.parentDocumentId);
    if (!parent || parent.inTrash) await ctx.db.patch(doc._id, { parentDocumentId: undefined });
  }
  await setTrashState(ctx, (await ctx.db.get(doc._id))!, actor, false, undefined);
}

export const restoreFromTrash = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) fail("not_found", "Document not found.");
    const access = await documentAccess(ctx, profile, doc);
    if (access === "none") fail("not_found", "Document not found.");
    if (!accessAtLeast(access, "write")) fail("forbidden", "You can't restore this document.");
    await restoreDoc(ctx, doc, profile._id);
    return null;
  },
});

/**
 * Who may delete a page for good: whoever manages it, or the person who created it while they can still
 * edit it (a creator who was removed, made view-only, or whose workspace is closing can't).
 */
async function canDeletePermanently(ctx: MutationCtx | QueryCtx, profile: Doc<"profiles">, doc: Doc<"documents">, access?: Access) {
  const a = access ?? (await documentAccess(ctx, profile, doc));
  return accessAtLeast(a, "manage") || (doc.createdBy === profile._id && accessAtLeast(a, "write"));
}

/**
 * Queues a trashed page (and its nested pages) for permanent deletion by the deletion-job runner, which
 * works through the cascade (blocks, tasks, files, versions, comments…) in bounded batches. A page that
 * already has a job waiting isn't queued twice. Callers schedule the runner.
 */
async function queueDeletion(ctx: MutationCtx, doc: Doc<"documents">, requestedBy: Id<"profiles">, reason: string): Promise<void> {
  const existing = await ctx.db
    .query("deletionJobs")
    .withIndex("by_target", (q) => q.eq("kind", "document").eq("targetId", doc._id))
    .order("desc")
    .first();
  if (existing && (existing.status === "scheduled" || existing.status === "running")) return;
  await ctx.db.insert("deletionJobs", {
    kind: "document",
    targetId: doc._id,
    requestedBy,
    requestedByAdmin: false,
    reason,
    scheduledFor: Date.now(),
    status: "scheduled",
    progress: 0,
    createdAt: Date.now(),
  });
}

/** Permanent deletion is irreversible: requires manage access, the document to be in Trash, and the title typed back. */
export const deletePermanently = mutation({
  args: { documentId: v.string(), confirmTitle: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) fail("not_found", "Document not found.");
    const access = await documentAccess(ctx, profile, doc);
    if (access === "none") fail("not_found", "Document not found.");
    if (!(await canDeletePermanently(ctx, profile, doc, access))) fail("forbidden", "Only the owner or a workspace admin can delete permanently.");
    if (!doc.inTrash) fail("invalid_argument", "Move the document to Trash first.");
    if (args.confirmTitle.trim() !== (doc.title.trim() || "Untitled")) fail("invalid_argument", "Type the document title to confirm.");
    await queueDeletion(ctx, doc, profile._id, "user_request");
    await ctx.scheduler.runAfter(0, internal.maintenance.runDeletionJobs, {});
    return null;
  },
});

/** The top of a trashed page's trashed ancestry: the page whose deletion takes this one with it. */
async function trashRoot(ctx: QueryCtx | MutationCtx, doc: Doc<"documents">): Promise<Doc<"documents">> {
  let root = doc;
  for (let i = 0; root.parentDocumentId && i < 12; i++) {
    const parent = await ctx.db.get(root.parentDocumentId);
    if (!parent || !parent.inTrash) break;
    root = parent;
  }
  return root;
}

const TRASH_COUNT_CAP = 500;

/**
 * How many pages in this scope's Trash the caller can open (`total`) and how many emptying it would delete
 * for them (pages they can't delete stay), over the newest TRASH_COUNT_CAP trashed pages, with `more` set
 * beyond it. For the "Empty Trash" confirmation. A restricted page the caller can't open is never counted.
 */
export const trashSummary = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope, level } = standing;
    const fetched = await scopeDocuments(ctx, scope, true, "created").take(TRASH_COUNT_CAP + 1);
    const trashed = await new PageReader(ctx, profile, standing).filter(fetched);
    let deletable = 0;
    if (levelAtLeast(level, "edit")) {
      const verdicts = new Map<Id<"documents">, boolean>();
      for (const d of trashed.slice(0, TRASH_COUNT_CAP)) {
        const root = await trashRoot(ctx, d);
        let ok = verdicts.get(root._id);
        if (ok === undefined) {
          ok = await canDeletePermanently(ctx, profile, root);
          verdicts.set(root._id, ok);
        }
        if (ok) deletable++;
      }
    }
    return { total: Math.min(trashed.length, TRASH_COUNT_CAP), deletable, more: trashed.length > TRASH_COUNT_CAP };
  },
});

const EMPTY_TRASH_PAGE = 100;

/**
 * One page of "Empty Trash": queues deletion of the trashed pages (roots of trashed trees) the person may
 * delete. A large Trash continues in follow-up mutations so no single one runs into Convex's limits.
 */
async function emptyTrashPage(ctx: MutationCtx, profile: Doc<"profiles">, scope: Scope, cursor: string | null) {
  const page = await scopeDocuments(ctx, scope, true, "created").paginate({ cursor, numItems: EMPTY_TRASH_PAGE });
  let queued = 0;
  for (const d of page.page) {
    if (d.parentDocumentId) {
      const parent = await ctx.db.get(d.parentDocumentId);
      if (parent?.inTrash) continue; // deleted with its root
    }
    if (!(await canDeletePermanently(ctx, profile, d))) continue;
    await queueDeletion(ctx, d, profile._id, "empty_trash");
    queued++;
  }
  if (queued) await ctx.scheduler.runAfter(0, internal.maintenance.runDeletionJobs, {});
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.documents.emptyTrashContinue, { profileId: profile._id, scope, cursor: page.continueCursor });
  return { queued, done: page.isDone };
}

export const emptyTrash = mutation({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    await consume(ctx, "bulk", profile._id);
    const r = await emptyTrashPage(ctx, profile, scope, null);
    return { scheduled: r.queued, continuing: !r.done };
  },
});

/** Follow-up pages of emptyTrash. Re-checks that the person may still do this before each page. */
/** A page's derived fields (search text, excerpt, counts, preview), refreshed after a large batch of edits. */
export const refreshDerivedLater = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (doc) await refreshDerived(ctx, doc);
    return null;
  },
});

export const emptyTrashContinue = internalMutation({
  args: { profileId: v.id("profiles"), scope: vScope, cursor: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.status !== "active") return null;
    const scope = args.scope;
    if (scope.kind === "personal") {
      if (scope.profileId !== profile._id) return null;
    } else {
      const member = await membership(ctx, profile._id, scope.workspaceId);
      if (!memberAtLeast(member, "edit")) return null;
    }
    await emptyTrashPage(ctx, profile, scope, args.cursor);
    return null;
  },
});

export const move = mutation({
  args: { documentId: v.string(), folderId: v.optional(v.union(v.string(), v.null())), parentDocumentId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    const engine = new SyncEngine(ctx, profile, "server");
    const patch: { folderId?: string | null; parentDocumentId?: string | null } = {};
    if (args.folderId !== undefined) patch.folderId = args.folderId;
    if (args.parentDocumentId !== undefined) patch.parentDocumentId = args.parentDocumentId;
    const [r] = await engine.applyAll(null, [
      { opId: ulid(), kind: "document.update", documentId: doc.publicId, patch, baseRevision: doc.revision },
    ]);
    if (r?.status === "rejected") fail("invalid_argument", r.error?.message ?? "Could not move the document.");
    return null;
  },
});

export const MAX_BULK = 50;

/**
 * One action on several notes at once (multi-select in lists, dragging to a folder): move to a folder,
 * star, archive, move to Trash, restore, or delete permanently. Each note is authorized on its own, as
 * the single-note mutations do; notes the caller can't change are skipped and counted, never fatal.
 * `previousFolders` (for "move") lets the client undo. Clients send at most MAX_BULK ids per call.
 */
export const bulkUpdate = mutation({
  args: {
    documentIds: v.array(v.string()),
    action: v.union(
      v.object({ kind: v.literal("move"), folderId: v.union(v.string(), v.null()) }),
      v.object({ kind: v.literal("star"), starred: v.boolean() }),
      v.object({ kind: v.literal("archive"), archived: v.boolean() }),
      v.object({ kind: v.literal("trash") }),
      v.object({ kind: v.literal("restore") }),
      v.object({ kind: v.literal("delete") }),
    ),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const action = args.action;
    // Starring is personal (read access is enough), as in setStarred.
    if (action.kind !== "star") await assertWritable(ctx, profile);
    let ids = [...new Set(args.documentIds)];
    if (ids.length > MAX_BULK) fail("limit_exceeded", `At most ${MAX_BULK} notes at a time.`);
    if (action.kind === "restore") {
      // Parents before their nested pages, so a restored page lands back under its parent instead of at
      // the top level (restoring a page whose parent is still in Trash moves it out).
      const depth = new Map<string, number>();
      for (const id of ids) {
        let d = 0;
        let cursor = await getDocumentByPublicId(ctx, id);
        while (cursor?.parentDocumentId && d < 12) {
          cursor = await ctx.db.get(cursor.parentDocumentId);
          d++;
        }
        depth.set(id, d);
      }
      ids = [...ids].sort((a, b) => depth.get(a)! - depth.get(b)!);
    }
    const done: string[] = [];
    const previousFolders: Record<string, string | null> = {};
    if (!ids.length) return { done, skipped: 0, previousFolders };
    await consume(ctx, "bulk", profile._id);
    const need = action.kind === "star" ? "read" : "write";
    let skipped = 0;
    const moves: Doc<"documents">[] = [];
    for (const id of ids) {
      const found = await getDocumentByPublicId(ctx, id);
      const access = found ? await documentAccess(ctx, profile, found) : "none";
      if (!found || !accessAtLeast(access, need)) {
        skipped++;
        continue;
      }
      // Re-read: an earlier note in this batch may have taken this one with it (a nested page).
      const doc = (await ctx.db.get(found._id))!;
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
        case "star": {
          const existing = await ctx.db
            .query("stars")
            .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
            .unique();
          if (action.starred && !existing) await insertScoped(ctx, "stars", scopeOfRow(doc), { profileId: profile._id, documentId: doc._id, createdAt: Date.now() });
          else if (!action.starred && existing) await ctx.db.delete(existing._id);
          break;
        }
        case "archive":
          if (doc.inTrash) ok = false;
          else if (Boolean(doc.archivedAt) !== action.archived) await touchDoc(ctx, doc, { archivedAt: action.archived ? Date.now() : undefined }, profile._id);
          break;
        case "trash":
          if (!doc.inTrash) await setTrashState(ctx, doc, profile._id, true, Date.now());
          break;
        case "restore":
          await restoreDoc(ctx, doc, profile._id);
          break;
        case "delete":
          if (!doc.inTrash || !(await canDeletePermanently(ctx, profile, doc))) ok = false;
          // Exactly this page and its nested pages, as deletePermanently does.
          else await queueDeletion(ctx, doc, profile._id, "user_request");
          break;
      }
      if (ok) done.push(id);
      else skipped++;
    }
    if (moves.length) {
      // Moves take the same document.update path as a single move (and as offline clients).
      const resolver = new IdResolver(ctx);
      for (const d of moves) previousFolders[d.publicId] = await resolver.folder(d.folderId);
      const folderId = action.kind === "move" ? action.folderId : null;
      const engine = new SyncEngine(ctx, profile, "server");
      const results = await engine.applyAll(
        null,
        moves.map((d) => ({ opId: ulid(), kind: "document.update" as const, documentId: d.publicId, patch: { folderId }, baseRevision: d.revision })),
      );
      results.forEach((r, i) => {
        const id = moves[i]!.publicId;
        if (r.status === "rejected") {
          skipped++;
          delete previousFolders[id];
        } else done.push(id);
      });
    }
    if (action.kind === "delete" && done.length) await ctx.scheduler.runAfter(0, internal.maintenance.runDeletionJobs, {});
    return { done, skipped, previousFolders };
  },
});

export const reorder = mutation({
  args: { documentId: v.string(), afterDocumentId: v.union(v.string(), v.null()), beforeDocumentId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { doc } = await writableDoc(ctx, args.documentId);
    const after = args.afterDocumentId ? await getDocumentByPublicId(ctx, args.afterDocumentId) : null;
    const before = args.beforeDocumentId ? await getDocumentByPublicId(ctx, args.beforeDocumentId) : null;
    let rank: string;
    try {
      rank = rankBetween(after?.rank ?? null, before?.rank ?? null);
    } catch {
      rank = rankBetween(after?.rank ?? null, null);
    }
    // Arranging pages is not an edit: bump revision/seq so clients refresh, but keep "last edited" as is.
    await ctx.db.patch(doc._id, { rank, seq: await nextSeq(ctx, scopeOfRow(doc)), revision: doc.revision + 1 });
    return { rank };
  },
});

export const duplicate = mutation({
  args: { documentId: v.string(), asTemplate: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    // A copy stays in the page's scope, so it needs the right to add pages there (a guest can't).
    const { scope } = await requireRowScope(ctx, profile, doc, "edit", "Document not found.");
    const blocks = cloneBlocks((await liveBlocks(ctx, doc._id)).map(toWireBlock));
    const copy = await createDocument(ctx, {
      scope,
      actor: profile,
      title: args.asTemplate ? doc.title : `${doc.title || "Untitled"} (copy)`,
      icon: doc.icon,
      kind: args.asTemplate ? "template" : doc.kind === "template" ? "template" : "document",
      folderId: doc.folderId,
      parentDocumentId: args.asTemplate ? undefined : doc.parentDocumentId,
      style: doc.style,
      cover: doc.cover,
      blocks,
    });
    await copyCollectionsInto(ctx, copy);
    return await new Placement(ctx, profile).summary(new IdResolver(ctx), copy);
  },
});

// ---------------------------------------------------------------- daily notes
// Retired feature: kept read-only for clients that haven't updated yet. Quick Add uses the Inbox page.

export const daily = query({
  args: { scope: vScopeArg, date: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) fail("invalid_argument", "Invalid date.");
    const doc = await scopeDailies(ctx, scope, profile._id, args.date, args.date).first();
    return doc && !doc.inTrash ? await new Placement(ctx, profile).summary(new IdResolver(ctx), doc) : null;
  },
});

export const dailyDates = query({
  args: { scope: vScopeArg, from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const docs = await scopeDailies(ctx, scope, profile._id, args.from, args.to).take(400);
    return docs.filter((d) => !d.inTrash).map((d) => ({ id: d.publicId, date: d.dailyDate!, title: d.title, wordCount: d.wordCount }));
  },
});

// ---------------------------------------------------------------- snapshots / version history

/** Version content is stored in chunks of at most this many characters: at 4 bytes a character at most, under the 1 MiB a row may hold. */
const SNAPSHOT_CHUNK = 250_000;
const MAX_VERSION_NAME = 80;

/**
 * What a stored version holds. `authors` (who last changed each block, and when) and `removed` (who deleted
 * the blocks that are gone since the version before) are on versions saved since who-edited-what was added;
 * they carry internal profile ids, so they never leave the backend as stored (see versionContent).
 */
interface VersionContent {
  title: string;
  icon: string | null;
  style?: Doc<"documents">["style"];
  blocks: WireBlock[];
  authors?: Record<string, [Id<"profiles">, number]>;
  removed?: Record<string, [Id<"profiles">, number]>;
}

async function snapshotText(ctx: QueryCtx | MutationCtx, snap: Doc<"documentSnapshots">): Promise<string | null> {
  if (snap.content !== undefined) return snap.content;
  if (!snap.chunkCount) return null;
  const chunks = await ctx.db
    .query("snapshotChunks")
    .withIndex("by_snapshot", (q) => q.eq("snapshotId", snap._id))
    .collect();
  return chunks
    .sort((a, b) => a.index - b.index)
    .map((c) => c.data)
    .join("");
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function versionName(raw: string | undefined): string | undefined {
  const name = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_VERSION_NAME);
  return name || undefined;
}

/**
 * History belongs to the people who can edit the page, as in Google Docs: an old version can hold text that
 * was deleted on purpose, which someone who may only read the page shouldn't get back.
 */
async function historyDocument(ctx: QueryCtx | MutationCtx, publicId: string) {
  const profile = await requireProfile(ctx);
  const { doc } = await requireDocument(ctx, profile, publicId, "write");
  return { profile, doc };
}

async function versionByPublicId(ctx: QueryCtx | MutationCtx, publicId: string) {
  const snap = await ctx.db
    .query("documentSnapshots")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  if (!snap) fail("not_found", "Version not found.");
  const doc = await ctx.db.get(snap.documentId);
  if (!doc) fail("not_found", "Version not found.");
  const { profile } = await historyDocument(ctx, doc.publicId);
  return { snap, doc, profile };
}

export const createSnapshot = mutation({
  args: {
    documentId: v.string(),
    reason: v.union(v.literal("idle"), v.literal("close"), v.literal("manual")),
    /** Names the version ("Name current version"); with no changes since the last version, that one is named. */
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { profile, doc } = await writableDoc(ctx, args.documentId);
    return await snapshot(ctx, doc, profile._id, args.reason, versionName(args.name));
  },
});

async function snapshot(
  ctx: MutationCtx,
  doc: Doc<"documents">,
  actor: Id<"profiles">,
  reason: Doc<"documentSnapshots">["reason"],
  name?: string,
): Promise<{ created: boolean; id?: string }> {
  const last = await ctx.db
    .query("documentSnapshots")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .order("desc")
    .first();
  if (last && last.contentSeq === doc.contentSeq && last.title === doc.title && reason !== "before_restore") {
    // Nothing new to keep: naming "the current version" names the one that already holds it.
    if (name && last.name !== name) await ctx.db.patch(last._id, { name });
    return { created: false, id: last.publicId };
  }
  // Who did what since the version before: each block's last editor, and who deleted what's gone since.
  // "Since" includes its own moment: time stands still within a mutation, so a restore's changes carry the
  // same time as the version it saves first, and belong to the next one.
  const since = last?.createdAt ?? 0;
  const rows = await liveBlocks(ctx, doc._id);
  const blocks = rows.map(toWireBlock);
  const authors: Record<string, [Id<"profiles">, number]> = {};
  const changes = new Map<Id<"profiles">, number>();
  const count = (who: Id<"profiles">) => changes.set(who, (changes.get(who) ?? 0) + 1);
  for (const r of rows) {
    authors[r.blockId] = [r.updatedBy, r.updatedAt];
    if (r.updatedAt >= since) count(r.updatedBy);
  }
  const removed: Record<string, [Id<"profiles">, number]> = {};
  if (last) {
    const gone = await ctx.db
      .query("blocks")
      .withIndex("by_document_deleted", (q) => q.eq("documentId", doc._id).gte("deletedAt", since))
      .take(2000);
    for (const r of gone) {
      removed[r.blockId] = [r.updatedBy, r.deletedAt!];
      count(r.updatedBy);
    }
    if (doc.title !== last.title) count(doc.lastEditedBy);
  } else if (!changes.size) count(doc.lastEditedBy);
  const editors = [...changes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id]) => id);
  const stored: VersionContent = { title: doc.title, icon: doc.icon ?? null, style: doc.style, blocks, authors, removed };
  const content = JSON.stringify(stored);
  // Always in snapshotChunks, never on the version's own row: listing versions reads whole rows, and
  // hundreds of versions of a long page held inline would pass the 16 MiB a query may read.
  // (By whole characters: a chunk never ends in half of one.)
  const chunks = content.match(new RegExp(`[\\s\\S]{1,${SNAPSHOT_CHUNK}}`, "gu")) ?? [""];
  const publicId = ulid();
  const snapshotId = await insertScoped(ctx, "documentSnapshots", scopeOfRow(doc), {
    documentId: doc._id,
    publicId,
    reason,
    title: doc.title,
    chunkCount: chunks.length,
    blockCount: blocks.length,
    sizeBytes: content.length,
    contentSeq: doc.contentSeq,
    createdBy: actor,
    createdAt: Date.now(),
    name,
    editors,
  });
  for (const [index, data] of chunks.entries()) await ctx.db.insert("snapshotChunks", { snapshotId, index, data });
  return { created: true, id: publicId };
}

/**
 * The automatic version for a stretch of editing, scheduled by the first edit after a version (sync push,
 * lib/syncEngine.ts). It doesn't depend on any app staying open: long sessions, crashed tabs and other
 * devices all get their history.
 */
export const autoVersion = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;
    await ctx.db.patch(doc._id, { versionDueAt: undefined });
    if (doc.inTrash) return null;
    await snapshot(ctx, doc, doc.lastEditedBy, "idle");
    return null;
  },
});

/** The version list as older clients read it (the archived Swift Mac app). The web app uses `versions`. */
export const snapshots = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const { doc } = await historyDocument(ctx, args.documentId);
    const rows = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .order("desc")
      .take(100);
    const out = [];
    for (const r of rows) {
      const who = await ctx.db.get(r.createdBy);
      out.push({ id: r.publicId, reason: r.reason, title: r.title, blockCount: r.blockCount, createdAt: r.createdAt, createdBy: who?.displayName ?? "Someone" });
    }
    return out;
  },
});

/** A page's versions, newest first, with their names and who edited in each (people as keys into `people`). */
export const versions = query({
  args: { documentId: v.string(), namedOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { doc } = await historyDocument(ctx, args.documentId);
    const rows = args.namedOnly
      ? (
          await ctx.db
            .query("documentSnapshots")
            .withIndex("by_document_name", (q) => q.eq("documentId", doc._id).gt("name", ""))
            .take(200)
        ).sort((a, b) => b.createdAt - a.createdAt)
      : await ctx.db
          .query("documentSnapshots")
          .withIndex("by_document", (q) => q.eq("documentId", doc._id))
          .order("desc")
          .take(200);
    const people = new People(ctx);
    // The version each one is compared with: the one saved just before it (a named version's isn't listed).
    const previous = async (i: number) => {
      if (!args.namedOnly && i + 1 < rows.length) return rows[i + 1]!.publicId;
      const r = rows[i]!;
      const before = await ctx.db
        .query("documentSnapshots")
        .withIndex("by_document", (q) => q.eq("documentId", doc._id).lt("createdAt", r.createdAt))
        .order("desc")
        .first();
      return before?.publicId ?? null;
    };
    const out = [];
    for (const [i, r] of rows.entries()) {
      const editors = r.editors ?? [r.createdBy];
      out.push({
        id: r.publicId,
        previousId: await previous(i),
        reason: r.reason,
        name: r.name ?? null,
        title: r.title,
        blockCount: r.blockCount,
        createdAt: r.createdAt,
        editors: await Promise.all(editors.map(async (e) => (await people.get(e)).key)),
      });
    }
    return { versions: out, people: await people.all(), current: { contentSeq: doc.contentSeq, latestContentSeq: rows[0]?.contentSeq ?? null } };
  },
});

/** Turns stored version content into what a client may see: links labelled for this reader, people as keys. */
async function versionContent(ctx: QueryCtx, profile: Doc<"profiles">, raw: string) {
  const parsed = JSON.parse(raw) as VersionContent;
  if (!Array.isArray(parsed.blocks)) throw new Error("no blocks");
  const people = new People(ctx);
  // As lists of [block id, person key, time]: an object keyed by block can't go over the wire past 1024 blocks.
  const attribution = async (map: VersionContent["authors"]) => {
    const out: [string, string, number][] = [];
    for (const [blockId, [who, at]] of Object.entries(map ?? {})) out.push([blockId, (await people.get(who)).key, at]);
    return out;
  };
  const authors = await attribution(parsed.authors);
  const removed = await attribution(parsed.removed);
  // Links in an old version show labels this person may see, like the live page (lib/linkLabels.ts).
  const blocks = await new ReaderLabels(ctx, profile).blocks(parsed.blocks);
  return {
    content: JSON.stringify({ title: parsed.title, icon: parsed.icon, style: parsed.style, blocks }),
    authors: parsed.authors ? authors : null,
    removed: parsed.removed ? removed : null,
    people: await people.all(),
  };
}

export const snapshotContent = query({
  args: { snapshotId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const snap = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.snapshotId))
      .unique();
    if (!snap) return null;
    const doc = await ctx.db.get(snap.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "write")) return null;
    const raw = await snapshotText(ctx, snap);
    if (raw === null) return { content: null, authors: null, removed: null, people: {} };
    try {
      return await versionContent(ctx, profile, raw);
    } catch {
      return { content: null, authors: null, removed: null, people: {} };
    }
  },
});

/**
 * Who last changed each block of the page as it is now (the "Show editors" view, and the current version),
 * and with `since` (a version), who deleted what since that version.
 */
export const blockAuthors = query({
  args: { documentId: v.string(), since: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { doc } = await historyDocument(ctx, args.documentId);
    const people = new People(ctx);
    // Lists of [block id, person key, time], not objects keyed by block (at most 1024 fields per object).
    const authors: [string, string, number][] = [];
    for (const r of await liveBlocks(ctx, doc._id)) authors.push([r.blockId, (await people.get(r.updatedBy)).key, r.updatedAt]);
    // And, for version history, who deleted what since the version it's compared with (the current version's
    // removed lines). "Show editors" doesn't ask, so its keystroke-by-keystroke updates stay light.
    const latest = args.since
      ? await ctx.db
          .query("documentSnapshots")
          .withIndex("by_public_id", (q) => q.eq("publicId", args.since!))
          .unique()
      : null;
    const removed: [string, string, number][] = [];
    if (latest && latest.documentId === doc._id) {
      const gone = await ctx.db
        .query("blocks")
        .withIndex("by_document_deleted", (q) => q.eq("documentId", doc._id).gte("deletedAt", latest.createdAt))
        .take(2000);
      for (const r of gone) removed.push([r.blockId, (await people.get(r.updatedBy)).key, r.deletedAt!]);
    }
    return { authors, removed, people: await people.all() };
  },
});

/** Names a version, or clears its name (an empty name). */
export const nameVersion = mutation({
  args: { snapshotId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const { snap, profile } = await versionByPublicId(ctx, args.snapshotId);
    await assertWritable(ctx, profile);
    await ctx.db.patch(snap._id, { name: versionName(args.name) });
    return null;
  },
});

/** A new page holding a version's content, next to the original ("Make a copy"). */
export const copyVersion = mutation({
  args: { snapshotId: v.string() },
  handler: async (ctx, args) => {
    const { snap, doc, profile } = await versionByPublicId(ctx, args.snapshotId);
    await assertWritable(ctx, profile);
    const { scope } = await requireRowScope(ctx, profile, doc, "edit", "Document not found.");
    const raw = await snapshotText(ctx, snap);
    if (!raw) fail("not_found", "Version content is unavailable.");
    const parsed = JSON.parse(raw) as VersionContent;
    const copy = await createDocument(ctx, {
      scope,
      actor: profile,
      title: `${snap.name ?? parsed.title ?? "Untitled"} (copy)`.slice(0, 500),
      icon: parsed.icon ?? doc.icon,
      kind: doc.kind === "template" ? "template" : "document",
      folderId: doc.folderId,
      parentDocumentId: doc.parentDocumentId,
      style: parsed.style ?? doc.style,
      cover: doc.cover,
      blocks: cloneBlocks(parsed.blocks),
    });
    // Its databases are its own, as with Duplicate: rows edited in the copy don't change the original.
    await copyCollectionsInto(ctx, copy);
    return await new Placement(ctx, profile).summary(new IdResolver(ctx), copy);
  },
});

/** Restores a snapshot: snapshots the current state first, then rewrites blocks to match (ids preserved). */
export const restoreSnapshot = mutation({
  args: { snapshotId: v.string() },
  handler: async (ctx, args) => {
    const { snap, doc: writable, profile } = await versionByPublicId(ctx, args.snapshotId);
    await assertWritable(ctx, profile);
    const raw = await snapshotText(ctx, snap);
    if (!raw) fail("not_found", "Version content is unavailable.");
    const parsed = JSON.parse(raw) as VersionContent;
    // The page as it is now is kept first, so a restore can be undone (by restoring that version).
    const before = await snapshot(ctx, writable, profile._id, "before_restore");
    const seq = await nextSeq(ctx, scopeOfRow(writable));
    const now = Date.now();
    const current = await ctx.db
      .query("blocks")
      .withIndex("by_document", (q) => q.eq("documentId", writable._id))
      .collect();
    const byId = new Map(current.map((b) => [b.blockId, b]));
    const keep = new Set(parsed.blocks.map((b) => b.id));
    for (const b of parsed.blocks) {
      const existing = byId.get(b.id);
      if (existing) {
        // Lines that are already as they were stay untouched: they keep who wrote them ("Show editors"), and
        // edits made offline to them don't come back as conflicts.
        const sameContent = existing.type === b.type && sameJson(existing.text, b.text) && sameJson(existing.props, b.props);
        const samePlace = existing.deletedAt === undefined && existing.parentId === b.parentId && existing.rank === b.rank;
        if (sameContent && samePlace) continue;
        const revision = existing.revision + 1;
        await ctx.db.patch(existing._id, {
          parentId: b.parentId,
          rank: b.rank,
          type: b.type,
          schemaVersion: b.schemaVersion,
          text: b.text,
          props: b.props,
          deletedAt: undefined,
          revision,
          ...(sameContent ? {} : { contentRev: revision }),
          ...(samePlace ? {} : { positionRev: revision }),
          seq,
          updatedAt: now,
          updatedBy: profile._id,
        });
      } else {
        await insertScoped(ctx, "blocks", scopeOfRow(writable), {
          blockId: b.id,
          documentId: writable._id,
          parentId: b.parentId,
          rank: b.rank,
          type: b.type,
          schemaVersion: b.schemaVersion,
          text: b.text,
          props: b.props,
          revision: 1,
          contentRev: 1,
          positionRev: 1,
          seq,
          createdAt: now,
          updatedAt: now,
          updatedBy: profile._id,
        });
      }
    }
    for (const b of current) {
      if (!keep.has(b.blockId) && b.deletedAt === undefined) {
        await ctx.db.patch(b._id, { deletedAt: now, revision: b.revision + 1, seq, updatedAt: now, updatedBy: profile._id });
      }
    }
    const revision = writable.revision + 1;
    await ctx.db.patch(writable._id, {
      title: parsed.title,
      icon: parsed.icon ?? undefined,
      // The page's look as it was then too (versions saved before styles were kept leave it as it is).
      ...(parsed.style !== undefined ? { style: parsed.style } : {}),
      revision,
      titleRev: revision,
      seq,
      contentSeq: writable.contentSeq + 1,
      updatedAt: now,
      lastEditedBy: profile._id,
    });
    const fresh = (await ctx.db.get(writable._id))!;
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_document", (q) => q.eq("documentId", writable._id))
      .collect();
    for (const r of rows) {
      await syncTaskProjection(ctx, r, fresh, profile._id);
      await syncLinks(ctx, fresh, r);
    }
    await refreshDerived(ctx, fresh);
    if (fresh.title !== writable.title || (fresh.icon ?? null) !== (writable.icon ?? null)) await refreshLinkLabels(ctx, fresh, profile._id);
    return { undoVersionId: before.id ?? null };
  },
});

/** Old snapshots looked at per run of purgeSnapshots (each run then hands on to the next). */
const SNAPSHOT_PURGE_BATCH = 100;

export const purgeSnapshots = internalMutation({
  // A run started by the cron passes nothing; each follow-up carries the same cutoff and where to go on.
  args: { cursor: v.optional(v.string()), cutoff: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // Keep the newest 50 per document, anything younger than 30 days and every named version. The old ones are walked oldest
    // first with a cursor, so snapshots that are kept never stop the walk from reaching the rest.
    const cutoff = args.cutoff ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
    const { page: old, isDone, continueCursor } = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .paginate({ numItems: SNAPSHOT_PURGE_BATCH, cursor: args.cursor ?? null });
    // Per document: the time of its 50th newest snapshot. Anything older has 50 newer ones and goes.
    const keepFrom = new Map<string, number>();
    let removed = 0;
    for (const s of old) {
      let from = keepFrom.get(s.documentId);
      if (from === undefined) {
        const newest = await ctx.db
          .query("documentSnapshots")
          .withIndex("by_document", (q) => q.eq("documentId", s.documentId))
          .order("desc")
          .take(50);
        from = newest.length >= 50 ? newest[49]!.createdAt : -Infinity;
        keepFrom.set(s.documentId, from);
      }
      // A named version is someone's deliberate checkpoint: it stays as long as the page does.
      if (s.createdAt < from && !s.name) {
        const chunks = await ctx.db
          .query("snapshotChunks")
          .withIndex("by_snapshot", (q) => q.eq("snapshotId", s._id))
          .collect();
        for (const c of chunks) await ctx.db.delete(c._id);
        await ctx.db.delete(s._id);
        removed++;
      }
    }
    if (!isDone) await ctx.scheduler.runAfter(0, internal.documents.purgeSnapshots, { cursor: continueCursor, cutoff });
    return removed;
  },
});
