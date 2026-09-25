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
  requireWorkspace,
  roleAtLeast,
} from "./lib/auth";
import { IdResolver, liveBlocks, refreshDerived, syncTaskProjection, toSummary, toWireBlock, type DocumentSummary } from "./lib/documents";
import { SyncEngine, syncLinks } from "./lib/syncEngine";
import { cloneBlocks, createDocument } from "./lib/create";
import { fail } from "./lib/errors";
import { SeqAllocator, nextSeq } from "./lib/seq";
import { vDocumentKind } from "./lib/validators";

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type ListView = "all" | "starred" | "archive" | "trash" | "templates" | "daily" | "unsorted" | "folder" | "tag";

async function withExtras(ctx: QueryCtx, profile: Doc<"profiles">, ids: IdResolver, docs: Doc<"documents">[]) {
  const out: (DocumentSummary & { starred: boolean; tags: { id: string; name: string; color: string }[] })[] = [];
  for (const d of docs) {
    const star = await ctx.db
      .query("stars")
      .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", d._id))
      .unique();
    const tagLinks = await ctx.db
      .query("documentTags")
      .withIndex("by_document", (q) => q.eq("documentId", d._id))
      .take(20);
    const tags = [];
    for (const l of tagLinks) {
      const t = await ctx.db.get(l.tagId);
      if (t) tags.push({ id: t.publicId, name: t.name, color: t.color });
    }
    out.push({ ...(await toSummary(ids, d)), starred: Boolean(star), tags });
  }
  return out;
}

async function filterReadable(ctx: QueryCtx, profile: Doc<"profiles">, docs: Doc<"documents">[]) {
  const out: Doc<"documents">[] = [];
  for (const d of docs) if (accessAtLeast(await documentAccess(ctx, profile, d), "read")) out.push(d);
  return out;
}

/** Document lists for the browser (All, Starred, Archive, Trash, Templates, Daily, Unsorted, folder, tag). */
export const list = query({
  args: {
    workspaceId: v.string(),
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
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    const view = args.view as ListView;
    const ids = new IdResolver(ctx);
    const sort = args.sort ?? "updated";

    // Views backed by small per-person/per-container sets are fetched fully, then sorted.
    if (view === "starred" || view === "folder" || view === "tag") {
      let docs: Doc<"documents">[] = [];
      if (view === "starred") {
        const stars = await ctx.db
          .query("stars")
          .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
          .order("desc")
          .take(500);
        for (const s of stars) {
          const d = await ctx.db.get(s.documentId);
          if (d && d.workspaceId === workspace._id && !d.inTrash) docs.push(d);
        }
      } else if (view === "folder") {
        const folder = args.folderId
          ? await ctx.db
              .query("folders")
              .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId!))
              .unique()
          : null;
        if (!folder || folder.workspaceId !== workspace._id) fail("not_found", "Folder not found.");
        docs = (
          await ctx.db
            .query("documents")
            .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
            .take(1000)
        ).filter((d) => !d.inTrash && !d.archivedAt && !d.parentDocumentId && d.kind === "document");
      } else {
        const tag = args.tagId
          ? await ctx.db
              .query("tags")
              .withIndex("by_public_id", (q) => q.eq("publicId", args.tagId!))
              .unique()
          : null;
        if (!tag || tag.workspaceId !== workspace._id) fail("not_found", "Tag not found.");
        const links = await ctx.db
          .query("documentTags")
          .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
          .take(1000);
        for (const l of links) {
          const d = await ctx.db.get(l.documentId);
          if (d && !d.inTrash) docs.push(d);
        }
      }
      docs = await filterReadable(ctx, profile, docs);
      docs.sort(sorter(sort));
      const start = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
      const page = docs.slice(start, start + args.paginationOpts.numItems);
      const end = start + page.length;
      return {
        page: await withExtras(ctx, profile, ids, page),
        isDone: end >= docs.length,
        continueCursor: String(end),
      };
    }

    const inTrash = view === "trash";
    const result = await ctx.db
      .query("documents")
      .withIndex("by_workspace_trash", (q) => q.eq("workspaceId", workspace._id).eq("inTrash", inTrash))
      .order("desc")
      .filter((q) => {
        switch (view) {
          case "archive":
            return q.and(q.neq(q.field("archivedAt"), undefined), q.eq(q.field("parentDocumentId"), undefined));
          case "templates":
            return q.eq(q.field("kind"), "template");
          case "daily":
            return q.and(q.eq(q.field("kind"), "daily"), q.eq(q.field("dailyOwnerId"), profile._id));
          case "unsorted":
            return q.and(
              q.eq(q.field("kind"), "document"),
              q.eq(q.field("folderId"), undefined),
              q.eq(q.field("archivedAt"), undefined),
              q.eq(q.field("parentDocumentId"), undefined),
            );
          case "trash":
            return q.eq(q.field("kind"), q.field("kind"));
          default:
            return q.and(
              q.eq(q.field("kind"), "document"),
              q.eq(q.field("archivedAt"), undefined),
              q.eq(q.field("parentDocumentId"), undefined),
            );
        }
      })
      .paginate(args.paginationOpts);
    let page = await filterReadable(ctx, profile, result.page);
    if (sort !== "updated") page = [...page].sort(sorter(sort));
    return { ...result, page: await withExtras(ctx, profile, ids, page) };
  },
});

function sorter(sort: "updated" | "created" | "title" | "manual") {
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
    const folder = doc.folderId ? await ctx.db.get(doc.folderId) : null;
    const [extras] = await withExtras(ctx, profile, ids, [doc]);
    const member = await membership(ctx, profile._id, doc.workspaceId);
    const lastEditor = await ctx.db.get(doc.lastEditedBy);
    const creator = await ctx.db.get(doc.createdBy);
    return {
      document: extras!,
      access,
      isMember: Boolean(member),
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
    const readable = await filterReadable(
      ctx,
      profile,
      kids.filter((k) => !k.inTrash && k.kind !== "collectionRow"),
    );
    return await Promise.all(readable.map((k) => toSummary(ids, k)));
  },
});

/** Backlinks (documents linking here) and unlinked mentions (documents mentioning the title). */
export const backlinks = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
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
      const hits = await ctx.db
        .query("documents")
        .withSearchIndex("search_text", (q) => q.search("searchText", `"${title.replace(/"/g, "")}"`).eq("workspaceId", doc.workspaceId).eq("inTrash", false))
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
  args: { workspaceId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    const rows = await ctx.db
      .query("recents")
      .withIndex("by_profile_viewed", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(60);
    const ids = new IdResolver(ctx);
    const out: DocumentSummary[] = [];
    for (const r of rows) {
      if (r.workspaceId !== workspace._id) continue;
      const d = await ctx.db.get(r.documentId);
      if (!d || d.inTrash) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
      out.push(await toSummary(ids, d));
      if (out.length >= Math.min(args.limit ?? 8, 30)) break;
    }
    return out;
  },
});

export const recordView = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const existing = await ctx.db
      .query("recents")
      .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
      .unique();
    const now = Date.now();
    if (existing) {
      if (now - existing.viewedAt > 30_000) await ctx.db.patch(existing._id, { viewedAt: now });
    } else {
      await ctx.db.insert("recents", { profileId: profile._id, documentId: doc._id, workspaceId: doc.workspaceId, viewedAt: now });
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
  const seq = await nextSeq(ctx, doc.workspaceId);
  await ctx.db.patch(doc._id, { ...patch, seq, revision: doc.revision + 1, updatedAt: Date.now(), lastEditedBy: actor });
}

/** Online document creation (offline clients use sync.push with a document.create op). */
export const create = mutation({
  args: {
    workspaceId: v.string(),
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
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "editor");
    const engine = new SyncEngine(ctx, profile, "server");
    const [result] = await engine.applyAll(workspace.publicId, [
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
      await ctx.db.insert("stars", { profileId: profile._id, documentId: doc._id, workspaceId: doc.workspaceId, createdAt: Date.now() });
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

async function setTrashState(ctx: MutationCtx, doc: Doc<"documents">, actor: Id<"profiles">, inTrash: boolean, stamp: number | undefined) {
  const seq = new SeqAllocator(ctx);
  const s = await seq.for(doc.workspaceId);
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

export const restoreFromTrash = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) fail("not_found", "Document not found.");
    const access = await documentAccess(ctx, profile, doc);
    if (!accessAtLeast(access, "write")) fail("forbidden", "You can't restore this document.");
    if (!doc.inTrash) return null;
    // If the parent is still in Trash, restore to the top level.
    if (doc.parentDocumentId) {
      const parent = await ctx.db.get(doc.parentDocumentId);
      if (!parent || parent.inTrash) await ctx.db.patch(doc._id, { parentDocumentId: undefined });
    }
    await setTrashState(ctx, (await ctx.db.get(doc._id))!, profile._id, false, undefined);
    return null;
  },
});

/** Permanent deletion is irreversible: requires manage access, the document to be in Trash, and the title typed back. */
export const deletePermanently = mutation({
  args: { documentId: v.string(), confirmTitle: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) fail("not_found", "Document not found.");
    const access = await documentAccess(ctx, profile, doc);
    if (!accessAtLeast(access, "manage") && doc.createdBy !== profile._id) fail("forbidden", "Only the owner or a workspace admin can delete permanently.");
    if (!doc.inTrash) fail("invalid_argument", "Move the document to Trash first.");
    if (args.confirmTitle.trim() !== (doc.title.trim() || "Untitled")) fail("invalid_argument", "Type the document title to confirm.");
    await ctx.db.insert("deletionJobs", {
      kind: "document",
      targetId: doc._id,
      requestedBy: profile._id,
      requestedByAdmin: false,
      reason: "user_request",
      scheduledFor: Date.now(),
      status: "scheduled",
      progress: 0,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.maintenance.runDeletionJobs, {});
    return null;
  },
});

export const emptyTrash = mutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace, member } = await requireWorkspace(ctx, profile, args.workspaceId, "editor");
    const trashed = await ctx.db
      .query("documents")
      .withIndex("by_workspace_trash", (q) => q.eq("workspaceId", workspace._id).eq("inTrash", true))
      .take(500);
    let count = 0;
    for (const d of trashed) {
      if (!roleAtLeast(member.role, "admin") && d.createdBy !== profile._id) continue;
      if (d.parentDocumentId) {
        const parent = await ctx.db.get(d.parentDocumentId);
        if (parent?.inTrash) continue; // deleted with its root
      }
      await ctx.db.insert("deletionJobs", {
        kind: "document",
        targetId: d._id,
        requestedBy: profile._id,
        requestedByAdmin: false,
        reason: "empty_trash",
        scheduledFor: Date.now(),
        status: "scheduled",
        progress: 0,
        createdAt: Date.now(),
      });
      count++;
    }
    await ctx.scheduler.runAfter(0, internal.maintenance.runDeletionJobs, {});
    return { scheduled: count };
  },
});

export const move = mutation({
  args: { documentId: v.string(), folderId: v.optional(v.union(v.string(), v.null())), parentDocumentId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    const workspace = (await ctx.db.get(doc.workspaceId))!;
    const engine = new SyncEngine(ctx, profile, "server");
    const patch: { folderId?: string | null; parentDocumentId?: string | null } = {};
    if (args.folderId !== undefined) patch.folderId = args.folderId;
    if (args.parentDocumentId !== undefined) patch.parentDocumentId = args.parentDocumentId;
    const [r] = await engine.applyAll(workspace.publicId, [
      { opId: ulid(), kind: "document.update", documentId: doc.publicId, patch, baseRevision: doc.revision },
    ]);
    if (r?.status === "rejected") fail("invalid_argument", r.error?.message ?? "Could not move the document.");
    return null;
  },
});

export const reorder = mutation({
  args: { documentId: v.string(), afterDocumentId: v.union(v.string(), v.null()), beforeDocumentId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { profile, doc } = await writableDoc(ctx, args.documentId);
    const after = args.afterDocumentId ? await getDocumentByPublicId(ctx, args.afterDocumentId) : null;
    const before = args.beforeDocumentId ? await getDocumentByPublicId(ctx, args.beforeDocumentId) : null;
    let rank: string;
    try {
      rank = rankBetween(after?.rank ?? null, before?.rank ?? null);
    } catch {
      rank = rankBetween(after?.rank ?? null, null);
    }
    await touchDoc(ctx, doc, { rank }, profile._id);
    return { rank };
  },
});

export const duplicate = mutation({
  args: { documentId: v.string(), asTemplate: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    await requireWorkspace(ctx, profile, (await ctx.db.get(doc.workspaceId))!.publicId, "editor");
    const blocks = cloneBlocks((await liveBlocks(ctx, doc._id)).map(toWireBlock));
    const copy = await createDocument(ctx, {
      workspaceId: doc.workspaceId,
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
    return await toSummary(new IdResolver(ctx), copy);
  },
});

// ---------------------------------------------------------------- daily notes

export const daily = query({
  args: { workspaceId: v.string(), date: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) fail("invalid_argument", "Invalid date.");
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_daily", (q) => q.eq("workspaceId", workspace._id).eq("dailyOwnerId", profile._id).eq("dailyDate", args.date))
      .first();
    return doc && !doc.inTrash ? await toSummary(new IdResolver(ctx), doc) : null;
  },
});

export const dailyDates = query({
  args: { workspaceId: v.string(), from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_daily", (q) =>
        q.eq("workspaceId", workspace._id).eq("dailyOwnerId", profile._id).gte("dailyDate", args.from).lte("dailyDate", args.to),
      )
      .take(400);
    return docs.filter((d) => !d.inTrash).map((d) => ({ id: d.publicId, date: d.dailyDate!, title: d.title, wordCount: d.wordCount }));
  },
});

// ---------------------------------------------------------------- snapshots / version history

const MAX_INLINE_SNAPSHOT = 700_000;

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

export const createSnapshot = mutation({
  args: {
    documentId: v.string(),
    reason: v.union(v.literal("idle"), v.literal("close"), v.literal("manual")),
  },
  handler: async (ctx, args) => {
    const { profile, doc } = await writableDoc(ctx, args.documentId);
    return await snapshot(ctx, doc, profile._id, args.reason);
  },
});

async function snapshot(
  ctx: MutationCtx,
  doc: Doc<"documents">,
  actor: Id<"profiles">,
  reason: Doc<"documentSnapshots">["reason"],
): Promise<{ created: boolean; id?: string }> {
  const last = await ctx.db
    .query("documentSnapshots")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .order("desc")
    .first();
  if (last && last.contentSeq === doc.contentSeq && last.title === doc.title && reason !== "before_restore") {
    return { created: false };
  }
  const blocks = (await liveBlocks(ctx, doc._id)).map(toWireBlock);
  const content = JSON.stringify({ title: doc.title, icon: doc.icon ?? null, style: doc.style, blocks });
  const inline = content.length > MAX_INLINE_SNAPSHOT ? undefined : content;
  const chunks = inline ? [] : (content.match(new RegExp(`[\\s\\S]{1,${MAX_INLINE_SNAPSHOT}}`, "g")) ?? []);
  const publicId = ulid();
  const snapshotId = await ctx.db.insert("documentSnapshots", {
    documentId: doc._id,
    workspaceId: doc.workspaceId,
    publicId,
    reason,
    title: doc.title,
    content: inline,
    chunkCount: chunks.length || undefined,
    blockCount: blocks.length,
    sizeBytes: content.length,
    contentSeq: doc.contentSeq,
    createdBy: actor,
    createdAt: Date.now(),
  });
  for (const [index, data] of chunks.entries()) await ctx.db.insert("snapshotChunks", { snapshotId, index, data });
  return { created: true, id: publicId };
}

export const snapshots = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
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
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    return { content: await snapshotText(ctx, snap) };
  },
});

/** Restores a snapshot: snapshots the current state first, then rewrites blocks to match (ids preserved). */
export const restoreSnapshot = mutation({
  args: { snapshotId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const snap = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.snapshotId))
      .unique();
    if (!snap) fail("not_found", "Version not found.");
    const doc = (await ctx.db.get(snap.documentId))!;
    const { doc: writable } = await requireDocument(ctx, profile, doc.publicId, "write");
    const raw = await snapshotText(ctx, snap);
    if (!raw) fail("not_found", "Version content is unavailable.");
    const parsed = JSON.parse(raw) as { title: string; icon: string | null; blocks: WireBlock[] };
    await snapshot(ctx, writable, profile._id, "before_restore");
    const seq = await nextSeq(ctx, writable.workspaceId);
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
          contentRev: revision,
          positionRev: revision,
          seq,
          updatedAt: now,
          updatedBy: profile._id,
        });
      } else {
        await ctx.db.insert("blocks", {
          blockId: b.id,
          documentId: writable._id,
          workspaceId: writable.workspaceId,
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
    return null;
  },
});

export const purgeSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Keep the newest 50 per document and anything younger than 30 days.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .take(200);
    let removed = 0;
    for (const s of old) {
      const newer = await ctx.db
        .query("documentSnapshots")
        .withIndex("by_document", (q) => q.eq("documentId", s.documentId).gt("createdAt", s.createdAt))
        .take(50);
      if (newer.length >= 50) {
        const chunks = await ctx.db
          .query("snapshotChunks")
          .withIndex("by_snapshot", (q) => q.eq("snapshotId", s._id))
          .collect();
        for (const c of chunks) await ctx.db.delete(c._id);
        await ctx.db.delete(s._id);
        removed++;
      }
    }
    return removed;
  },
});
